import { Hono } from "hono";
import { DOStorage, RealDOStorage } from "./base";
import type { Clock } from "../lib/clock";
import { realClock } from "../lib/clock";

export interface NodeCapacity {
  nodeId: string;
  totalVcpu: number;
  usedVcpu: number;
  totalMemoryMb: number;
  usedMemoryMb: number;
  sandboxCount: number;
  status: "healthy" | "degraded" | "draining" | "cordoned" | "offline";
  region: string;
  lastHeartbeat: number;
}

export interface Reservation {
  nodeId: string;
  vcpu: number;
  memoryMb: number;
  expiresAt: number;
}

export interface PlacementRequest {
  vcpu: number;
  memoryMb: number;
  gpu?: string | null;
  region?: string;
}

export interface PlacementResult {
  nodeId: string;
  region: string;
}

type SchedulingStrategy = "bin-pack" | "spread" | "region-affinity";

export class GlobalSchedulerDO implements DurableObject {
  private app: Hono;
  private storage: DOStorage;
  private clock: Clock;

  constructor(state: DurableObjectState, _env: unknown) {
    this.storage = new RealDOStorage(state.storage);
    this.clock = realClock;
    this.app = this.buildRouter();
  }

  /** For testing: inject storage and clock */
  initForTest(storage: DOStorage, clock: Clock) {
    this.storage = storage;
    this.clock = clock;
  }

  private buildRouter(): Hono {
    const app = new Hono();

    app.post("/place", async (c) => {
      const req = (await c.req.json()) as PlacementRequest;
      const result = await this.placeSandbox(req);
      if (!result) {
        return c.json({ error: "capacity_exhausted", message: "No nodes with sufficient capacity" }, 503);
      }
      return c.json(result);
    });

    app.post("/update-node", async (c) => {
      const node = (await c.req.json()) as NodeCapacity;
      await this.updateNode(node);
      return c.json({ ok: true });
    });

    app.post("/remove-node", async (c) => {
      const { nodeId } = (await c.req.json()) as { nodeId: string };
      await this.removeNode(nodeId);
      return c.json({ ok: true });
    });

    app.post("/allocate", async (c) => {
      const { sandboxId, nodeId, vcpu, memoryMb, timeoutMs } = (await c.req.json()) as {
        sandboxId: string;
        nodeId: string;
        vcpu: number;
        memoryMb: number;
        timeoutMs: number;
      };
      await this.allocateResources(sandboxId, nodeId, vcpu, memoryMb, timeoutMs);
      return c.json({ ok: true });
    });

    app.post("/release", async (c) => {
      const { sandboxId } = (await c.req.json()) as { sandboxId: string };
      await this.releaseResources(sandboxId);
      return c.json({ ok: true });
    });

    app.get("/nodes", async (c) => {
      const nodes = await this.getAllNodes();
      return c.json({ nodes });
    });

    app.get("/strategy", async (c) => {
      const strategy = await this.storage.get<SchedulingStrategy>("config:strategy");
      return c.json({ strategy: strategy || "bin-pack" });
    });

    app.put("/strategy", async (c) => {
      const { strategy } = (await c.req.json()) as { strategy: SchedulingStrategy };
      await this.storage.put("config:strategy", strategy);
      return c.json({ strategy });
    });

    return app;
  }

  async fetch(request: Request): Promise<Response> {
    return this.app.fetch(request);
  }

  async placeSandbox(req: PlacementRequest): Promise<PlacementResult | null> {
    const nodes = await this.getAllNodes();
    const strategy = (await this.storage.get<SchedulingStrategy>("config:strategy")) || "bin-pack";

    const eligible = nodes.filter((n) => {
      if (n.status === "draining" || n.status === "cordoned" || n.status === "offline") return false;
      const freeVcpu = n.totalVcpu - n.usedVcpu;
      const freeMem = n.totalMemoryMb - n.usedMemoryMb;
      return freeVcpu >= req.vcpu && freeMem >= req.memoryMb;
    });

    if (eligible.length === 0) return null;

    // Apply region affinity filter if specified
    if (req.region) {
      const regionNodes = eligible.filter((n) => n.region === req.region);
      if (regionNodes.length > 0) {
        return this.selectByStrategy(regionNodes, strategy, req);
      }
    }

    return this.selectByStrategy(eligible, strategy, req);
  }

  private selectByStrategy(
    nodes: NodeCapacity[],
    strategy: SchedulingStrategy,
    _req: PlacementRequest
  ): PlacementResult {
    let selected: NodeCapacity;
    switch (strategy) {
      case "spread": {
        // Pick node with least sandboxes
        nodes.sort((a, b) => a.sandboxCount - b.sandboxCount);
        selected = nodes[0];
        break;
      }
      case "bin-pack":
      default: {
        // Pick node with least free resources (pack tightly)
        nodes.sort((a, b) => {
          const freeA = (a.totalVcpu - a.usedVcpu) + (a.totalMemoryMb - a.usedMemoryMb) / 1024;
          const freeB = (b.totalVcpu - b.usedVcpu) + (b.totalMemoryMb - b.usedMemoryMb) / 1024;
          return freeA - freeB;
        });
        selected = nodes[0];
        break;
      }
    }
    return { nodeId: selected.nodeId, region: selected.region };
  }

  async updateNode(node: NodeCapacity): Promise<void> {
    // Preserve scheduler-tracked usage — heartbeats only update capacity metadata
    const existing = await this.storage.get<NodeCapacity>(`node:${node.nodeId}`);
    if (existing) {
      node.usedVcpu = existing.usedVcpu;
      node.usedMemoryMb = existing.usedMemoryMb;
      node.sandboxCount = existing.sandboxCount;
    }
    await this.storage.put(`node:${node.nodeId}`, node);
  }

  async removeNode(nodeId: string): Promise<void> {
    await this.storage.delete(`node:${nodeId}`);
  }

  async allocateResources(sandboxId: string, nodeId: string, vcpu: number, memoryMb: number, timeoutMs: number): Promise<void> {
    const expiresAt = this.clock.now() + timeoutMs;

    // Store reservation keyed by sandboxId
    const reservation: Reservation = { nodeId, vcpu, memoryMb, expiresAt };
    await this.storage.put(`reservation:${sandboxId}`, reservation);

    // Increment node counters
    const node = await this.storage.get<NodeCapacity>(`node:${nodeId}`);
    if (node) {
      node.usedVcpu += vcpu;
      node.usedMemoryMb += memoryMb;
      node.sandboxCount += 1;
      await this.storage.put(`node:${nodeId}`, node);
    }

    // Ensure alarm fires no later than this reservation's expiry
    const currentAlarm = await this.storage.getAlarm();
    if (currentAlarm === null || expiresAt < currentAlarm) {
      await this.storage.setAlarm(expiresAt);
    }
  }

  async releaseResources(sandboxId: string): Promise<void> {
    const reservation = await this.storage.get<Reservation>(`reservation:${sandboxId}`);
    if (!reservation) return;

    await this.storage.delete(`reservation:${sandboxId}`);

    const node = await this.storage.get<NodeCapacity>(`node:${reservation.nodeId}`);
    if (node) {
      node.usedVcpu = Math.max(0, node.usedVcpu - reservation.vcpu);
      node.usedMemoryMb = Math.max(0, node.usedMemoryMb - reservation.memoryMb);
      node.sandboxCount = Math.max(0, node.sandboxCount - 1);
      await this.storage.put(`node:${reservation.nodeId}`, node);
    }
  }

  async alarm(): Promise<void> {
    const now = this.clock.now();
    const reservations = await this.storage.list<Reservation>({ prefix: "reservation:" });

    let nextAlarm: number | null = null;
    for (const [key, reservation] of reservations) {
      if (reservation.expiresAt <= now) {
        const sandboxId = key.slice("reservation:".length);
        await this.releaseResources(sandboxId);
      } else if (nextAlarm === null || reservation.expiresAt < nextAlarm) {
        nextAlarm = reservation.expiresAt;
      }
    }

    if (nextAlarm !== null) {
      await this.storage.setAlarm(nextAlarm);
    }
  }

  async getAllNodes(): Promise<NodeCapacity[]> {
    const entries = await this.storage.list<NodeCapacity>({ prefix: "node:" });
    return Array.from(entries.values());
  }
}
