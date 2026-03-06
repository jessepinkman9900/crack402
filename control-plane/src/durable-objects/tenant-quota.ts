import { Hono } from "hono";
import { DOStorage, RealDOStorage } from "./base";

export interface QuotaState {
  maxConcurrentSandboxes: number;
  currentCount: number;
  maxVcpu: number;
  usedVcpu: number;
  maxMemoryMb: number;
  usedMemoryMb: number;
}

const DEFAULT_QUOTA: QuotaState = {
  maxConcurrentSandboxes: 10,
  currentCount: 0,
  maxVcpu: 64,
  usedVcpu: 0,
  maxMemoryMb: 131072,
  usedMemoryMb: 0,
};

export class TenantQuotaDO implements DurableObject {
  private app: Hono;
  private storage: DOStorage;

  constructor(state: DurableObjectState, _env: unknown) {
    this.storage = new RealDOStorage(state.storage);
    this.app = this.buildRouter();
  }

  initForTest(storage: DOStorage) {
    this.storage = storage;
  }

  private buildRouter(): Hono {
    const app = new Hono();

    app.post("/init", async (c) => {
      const limits = await c.req.json();
      await this.initQuota(limits);
      return c.json({ ok: true }, 201);
    });

    app.post("/check", async (c) => {
      const { vcpu, memoryMb } = (await c.req.json()) as { vcpu: number; memoryMb: number };
      const result = await this.checkAndReserve(vcpu, memoryMb);
      if (!result.allowed) {
        return c.json({ error: "resource_limit_exceeded", message: result.reason }, 429);
      }
      return c.json({ allowed: true });
    });

    app.post("/release", async (c) => {
      const { vcpu, memoryMb } = (await c.req.json()) as { vcpu: number; memoryMb: number };
      await this.release(vcpu, memoryMb);
      return c.json({ ok: true });
    });

    app.get("/usage", async (c) => {
      const quota = await this.getQuota();
      return c.json(quota);
    });

    app.put("/limits", async (c) => {
      const limits = await c.req.json();
      await this.updateLimits(limits);
      return c.json({ ok: true });
    });

    return app;
  }

  async fetch(request: Request): Promise<Response> {
    return this.app.fetch(request);
  }

  async initQuota(limits?: Partial<QuotaState>): Promise<void> {
    const existing = await this.getQuota();
    if (existing) return; // Already initialized
    const quota: QuotaState = { ...DEFAULT_QUOTA, ...limits };
    await this.storage.put("quota", quota);
  }

  async checkAndReserve(
    vcpu: number,
    memoryMb: number
  ): Promise<{ allowed: boolean; reason?: string }> {
    const quota = await this.getQuota();
    if (!quota) {
      // Auto-init with defaults
      await this.initQuota();
      return this.checkAndReserve(vcpu, memoryMb);
    }

    if (quota.currentCount >= quota.maxConcurrentSandboxes) {
      return {
        allowed: false,
        reason: `Concurrent sandbox limit reached (${quota.maxConcurrentSandboxes})`,
      };
    }
    if (quota.usedVcpu + vcpu > quota.maxVcpu) {
      return {
        allowed: false,
        reason: `vCPU limit exceeded (${quota.usedVcpu + vcpu}/${quota.maxVcpu})`,
      };
    }
    if (quota.usedMemoryMb + memoryMb > quota.maxMemoryMb) {
      return {
        allowed: false,
        reason: `Memory limit exceeded (${quota.usedMemoryMb + memoryMb}/${quota.maxMemoryMb}MB)`,
      };
    }

    // Reserve
    quota.currentCount += 1;
    quota.usedVcpu += vcpu;
    quota.usedMemoryMb += memoryMb;
    await this.storage.put("quota", quota);

    return { allowed: true };
  }

  async release(vcpu: number, memoryMb: number): Promise<void> {
    const quota = await this.getQuota();
    if (!quota) return;

    quota.currentCount = Math.max(0, quota.currentCount - 1);
    quota.usedVcpu = Math.max(0, quota.usedVcpu - vcpu);
    quota.usedMemoryMb = Math.max(0, quota.usedMemoryMb - memoryMb);
    await this.storage.put("quota", quota);
  }

  async updateLimits(limits: Partial<Pick<QuotaState, "maxConcurrentSandboxes" | "maxVcpu" | "maxMemoryMb">>): Promise<void> {
    const quota = await this.getQuota();
    if (!quota) return;

    if (limits.maxConcurrentSandboxes !== undefined) quota.maxConcurrentSandboxes = limits.maxConcurrentSandboxes;
    if (limits.maxVcpu !== undefined) quota.maxVcpu = limits.maxVcpu;
    if (limits.maxMemoryMb !== undefined) quota.maxMemoryMb = limits.maxMemoryMb;
    await this.storage.put("quota", quota);
  }

  async getQuota(): Promise<QuotaState | null> {
    return (await this.storage.get<QuotaState>("quota")) || null;
  }
}
