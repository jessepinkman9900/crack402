import { Hono } from "hono";
import { DOStorage, RealDOStorage } from "./base";
import type { Clock } from "../lib/clock";
import { realClock } from "../lib/clock";
import type { SandboxStatus, SandboxEvent } from "../state-machine/sandbox-states";
import {
  transition,
  isTransitionError,
  type TransitionContext,
} from "../state-machine/sandbox-machine";
import type { SideEffect } from "../state-machine/effects";

export interface SandboxState {
  sandboxId: string;
  tenantId: string;
  nodeId: string;
  status: SandboxStatus;
  baseImage: string;
  vcpu: number;
  memoryMb: number;
  gpu: string | null;
  timeoutSeconds: number;
  idleTimeoutSeconds: number;
  autoPauseOnIdle: boolean;
  autoDestroy: boolean;
  billingStartedAt: number | null;
  totalBilledMs: number;
  ratePerSecondUsd: number;
  createdAt: number;
}

export class SandboxTrackerDO implements DurableObject {
  private app: Hono;
  private storage: DOStorage;
  private clock: Clock;

  constructor(state: DurableObjectState, _env: unknown) {
    this.storage = new RealDOStorage(state.storage);
    this.clock = realClock;
    this.app = this.buildRouter();
  }

  initForTest(storage: DOStorage, clock: Clock) {
    this.storage = storage;
    this.clock = clock;
  }

  private buildRouter(): Hono {
    const app = new Hono();

    app.post("/init", async (c) => {
      const config = await c.req.json();
      await this.initSandbox(config);
      return c.json({ ok: true }, 201);
    });

    app.post("/transition", async (c) => {
      const { event } = (await c.req.json()) as { event: SandboxEvent };
      const result = await this.handleTransition(event);
      if ("error" in result) {
        return c.json(result, 409);
      }
      return c.json(result);
    });

    app.post("/exec-activity", async (c) => {
      await this.recordExecActivity();
      return c.json({ ok: true });
    });

    app.get("/state", async (c) => {
      const state = await this.getState();
      if (!state) {
        return c.json({ error: "not_initialized" }, 404);
      }
      return c.json(state);
    });

    app.get("/billing", async (c) => {
      const total = await this.getBillingTotal();
      return c.json(total);
    });

    return app;
  }

  async fetch(request: Request): Promise<Response> {
    return this.app.fetch(request);
  }

  async alarm(): Promise<void> {
    const state = await this.getState();
    if (!state) return;

    const alarmType = await this.storage.get<"ttl" | "idle">("alarmType");

    if (alarmType === "ttl") {
      await this.handleTransition("timeout");
    } else if (alarmType === "idle") {
      await this.handleTransition("idle_timeout");
    }
  }

  async initSandbox(config: {
    sandboxId: string;
    tenantId: string;
    nodeId: string;
    baseImage: string;
    vcpu: number;
    memoryMb: number;
    gpu?: string | null;
    timeoutSeconds: number;
    idleTimeoutSeconds: number;
    autoPauseOnIdle: boolean;
    autoDestroy: boolean;
  }): Promise<void> {
    const state: SandboxState = {
      sandboxId: config.sandboxId,
      tenantId: config.tenantId,
      nodeId: config.nodeId,
      status: "provisioning",
      baseImage: config.baseImage,
      vcpu: config.vcpu,
      memoryMb: config.memoryMb,
      gpu: config.gpu || null,
      timeoutSeconds: config.timeoutSeconds,
      idleTimeoutSeconds: config.idleTimeoutSeconds,
      autoPauseOnIdle: config.autoPauseOnIdle,
      autoDestroy: config.autoDestroy,
      billingStartedAt: null,
      totalBilledMs: 0,
      ratePerSecondUsd: 0,
      createdAt: this.clock.now(),
    };
    await this.storage.put("state", state);
  }

  async handleTransition(
    event: SandboxEvent
  ): Promise<{ newState: SandboxStatus; effects: SideEffect[] } | { error: string }> {
    const state = await this.getState();
    if (!state) {
      return { error: "Sandbox not initialized" };
    }

    const ctx: TransitionContext = {
      sandboxId: state.sandboxId,
      tenantId: state.tenantId,
      nodeId: state.nodeId,
      resources: { vcpu: state.vcpu, memoryMb: state.memoryMb, gpu: state.gpu },
      timeoutSeconds: state.timeoutSeconds,
      idleTimeoutSeconds: state.idleTimeoutSeconds,
      autoPauseOnIdle: state.autoPauseOnIdle,
      autoDestroy: state.autoDestroy,
    };

    const result = transition(state.status, event, ctx);
    if (isTransitionError(result)) {
      return { error: result.error };
    }

    // Apply billing effects locally
    const now = this.clock.now();
    if (state.status === "running" && result.newState !== "running") {
      // Stop billing
      if (state.billingStartedAt !== null) {
        state.totalBilledMs += now - state.billingStartedAt;
        state.billingStartedAt = null;
      }
    }
    if (result.newState === "running" && state.status !== "running") {
      // Start billing
      state.billingStartedAt = now;
    }

    // Update rate from effects
    for (const effect of result.effects) {
      if (effect.type === "start_billing_meter") {
        state.ratePerSecondUsd = effect.ratePerSecondUsd;
      }
    }

    // Update state
    state.status = result.newState;
    await this.storage.put("state", state);

    // Handle timer effects
    await this.processTimerEffects(result.effects);

    return { newState: result.newState, effects: result.effects };
  }

  async recordExecActivity(): Promise<void> {
    const state = await this.getState();
    if (!state || state.status !== "running") return;

    // Reset idle timer
    if (state.idleTimeoutSeconds > 0) {
      const nextAlarm = this.clock.now() + state.idleTimeoutSeconds * 1000;
      await this.storage.put("alarmType", "idle");
      await this.storage.setAlarm(nextAlarm);
    }
  }

  async getState(): Promise<SandboxState | null> {
    return (await this.storage.get<SandboxState>("state")) || null;
  }

  async getBillingTotal(): Promise<{
    totalBilledMs: number;
    totalCostUsd: number;
    isRunning: boolean;
  }> {
    const state = await this.getState();
    if (!state) {
      return { totalBilledMs: 0, totalCostUsd: 0, isRunning: false };
    }

    let totalMs = state.totalBilledMs;
    if (state.billingStartedAt !== null) {
      totalMs += this.clock.now() - state.billingStartedAt;
    }

    const totalCostUsd = (totalMs / 1000) * state.ratePerSecondUsd;

    return {
      totalBilledMs: totalMs,
      totalCostUsd,
      isRunning: state.billingStartedAt !== null,
    };
  }

  private async processTimerEffects(effects: SideEffect[]): Promise<void> {
    for (const effect of effects) {
      if (effect.type === "arm_ttl_timer") {
        await this.storage.put("alarmType", "ttl");
        await this.storage.setAlarm(this.clock.now() + effect.durationMs);
      } else if (effect.type === "arm_idle_timer") {
        await this.storage.put("alarmType", "idle");
        await this.storage.setAlarm(this.clock.now() + effect.durationMs);
      } else if (effect.type === "cancel_timer") {
        const currentType = await this.storage.get<string>("alarmType");
        if (currentType === effect.timerType) {
          await this.storage.deleteAlarm();
          await this.storage.delete("alarmType");
        }
      }
    }
  }
}
