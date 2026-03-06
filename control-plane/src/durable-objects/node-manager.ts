import { Hono } from "hono";
import { DOStorage, RealDOStorage } from "./base";
import type { Clock } from "../lib/clock";
import { realClock } from "../lib/clock";
import { generateCommandId } from "../lib/id";
import type { Random } from "../lib/random";
import { realRandom } from "../lib/random";

const HEARTBEAT_TIMEOUT_MS = 60_000; // 60s — mark offline after this

export interface StoredCommand {
  commandId: string;
  type: string;
  sandboxId?: string;
  payload: Record<string, unknown>;
  createdAt: number;
  status: "pending" | "acked" | "completed" | "failed";
  result?: Record<string, unknown>;
  error?: string;
}

export class NodeManagerDO implements DurableObject {
  private app: Hono;
  private storage: DOStorage;
  private clock: Clock;
  private random: Random;

  constructor(state: DurableObjectState, _env: unknown) {
    this.storage = new RealDOStorage(state.storage);
    this.clock = realClock;
    this.random = realRandom;
    this.app = this.buildRouter();
  }

  initForTest(storage: DOStorage, clock: Clock, random: Random) {
    this.storage = storage;
    this.clock = clock;
    this.random = random;
  }

  private buildRouter(): Hono {
    const app = new Hono();

    app.post("/heartbeat", async (c) => {
      const payload = await c.req.json();
      await this.handleHeartbeat(payload);
      return c.json({ ok: true });
    });

    app.post("/enqueue", async (c) => {
      const cmd = await c.req.json();
      const stored = await this.enqueueCommand(cmd);
      return c.json(stored, 201);
    });

    app.get("/commands", async (c) => {
      const commands = await this.getPendingCommands();
      return c.json({ commands });
    });

    app.post("/commands/:cmdId/ack", async (c) => {
      const cmdId = c.req.param("cmdId");
      await this.ackCommand(cmdId);
      return c.json({ ok: true });
    });

    app.post("/commands/:cmdId/result", async (c) => {
      const cmdId = c.req.param("cmdId");
      const result = await c.req.json();
      await this.completeCommand(cmdId, result);
      return c.json({ ok: true });
    });

    app.get("/status", async (c) => {
      const status = await this.storage.get<string>("status");
      const lastHeartbeat = await this.storage.get<number>("lastHeartbeat");
      return c.json({ status: status || "unknown", lastHeartbeat });
    });

    return app;
  }

  async fetch(request: Request): Promise<Response> {
    return this.app.fetch(request);
  }

  async alarm(): Promise<void> {
    // Heartbeat timeout — mark node offline
    const lastHeartbeat = await this.storage.get<number>("lastHeartbeat");
    const now = this.clock.now();

    if (lastHeartbeat && now - lastHeartbeat >= HEARTBEAT_TIMEOUT_MS) {
      await this.storage.put("status", "offline");
      // Store sandbox IDs that were on this node for the caller to handle
      const sandboxIds = await this.storage.get<string[]>("sandboxIds");
      if (sandboxIds && sandboxIds.length > 0) {
        await this.storage.put("offlineSandboxIds", sandboxIds);
      }
    }
  }

  async handleHeartbeat(payload: {
    sandbox_ids?: string[];
    status?: string;
    [key: string]: unknown;
  }): Promise<void> {
    const now = this.clock.now();
    await this.storage.put("lastHeartbeat", now);
    await this.storage.put("status", payload.status || "healthy");
    if (payload.sandbox_ids) {
      await this.storage.put("sandboxIds", payload.sandbox_ids);
    }
    // Reset alarm for next heartbeat timeout
    await this.storage.setAlarm(now + HEARTBEAT_TIMEOUT_MS);
  }

  async enqueueCommand(cmd: {
    type: string;
    sandboxId?: string;
    payload: Record<string, unknown>;
  }): Promise<StoredCommand> {
    const commandId = generateCommandId(this.random);
    const stored: StoredCommand = {
      commandId,
      type: cmd.type,
      sandboxId: cmd.sandboxId,
      payload: cmd.payload,
      createdAt: this.clock.now(),
      status: "pending",
    };
    await this.storage.put(`cmd:${commandId}`, stored);
    return stored;
  }

  async getPendingCommands(): Promise<StoredCommand[]> {
    const entries = await this.storage.list<StoredCommand>({ prefix: "cmd:" });
    return Array.from(entries.values())
      .filter((c) => c.status === "pending")
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  async ackCommand(commandId: string): Promise<void> {
    const cmd = await this.storage.get<StoredCommand>(`cmd:${commandId}`);
    if (cmd) {
      cmd.status = "acked";
      await this.storage.put(`cmd:${commandId}`, cmd);
    }
  }

  async completeCommand(
    commandId: string,
    result: { status: "success" | "failure"; error?: string; payload?: Record<string, unknown> }
  ): Promise<void> {
    const cmd = await this.storage.get<StoredCommand>(`cmd:${commandId}`);
    if (cmd) {
      cmd.status = result.status === "success" ? "completed" : "failed";
      cmd.result = result.payload;
      cmd.error = result.error;
      await this.storage.put(`cmd:${commandId}`, cmd);
    }
  }
}
