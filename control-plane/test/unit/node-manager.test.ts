import { describe, it, expect, beforeEach } from "vitest";
import { NodeManagerDO } from "../../src/durable-objects/node-manager";
import { InMemoryDOStorage } from "../helpers/in-memory-storage";
import type { Clock } from "../../src/lib/clock";
import type { Random } from "../../src/lib/random";

function makeClock(startMs = 1000000): Clock & { advance: (ms: number) => void } {
  return {
    time: startMs,
    now() { return this.time; },
    isoNow() { return new Date(this.time).toISOString(); },
    advance(ms: number) { this.time += ms; },
  } as any;
}

function makeRandom(): Random {
  let counter = 0;
  return {
    id: (prefix: string) => `${prefix}${"a".repeat(20)}${counter++}`,
    float: () => 0.5,
    int: (min: number, max: number) => min,
  };
}

describe("NodeManagerDO", () => {
  let manager: NodeManagerDO;
  let storage: InMemoryDOStorage;
  let clock: ReturnType<typeof makeClock>;
  let random: Random;

  beforeEach(() => {
    storage = new InMemoryDOStorage();
    clock = makeClock();
    random = makeRandom();
    manager = new NodeManagerDO({} as any, {});
    manager.initForTest(storage, clock, random);
  });

  it("enqueue command stores it", async () => {
    const cmd = await manager.enqueueCommand({
      type: "create_sandbox",
      sandboxId: "sbx_test",
      payload: { base_image: "python:3.12" },
    });
    expect(cmd.commandId).toBeDefined();
    expect(cmd.status).toBe("pending");
    expect(cmd.type).toBe("create_sandbox");
  });

  it("getPendingCommands returns pending commands in order", async () => {
    await manager.enqueueCommand({ type: "create_sandbox", payload: {} });
    clock.advance(100);
    await manager.enqueueCommand({ type: "destroy_sandbox", payload: {} });

    const commands = await manager.getPendingCommands();
    expect(commands.length).toBe(2);
    expect(commands[0].type).toBe("create_sandbox");
    expect(commands[1].type).toBe("destroy_sandbox");
  });

  it("ackCommand marks as acked", async () => {
    const cmd = await manager.enqueueCommand({ type: "exec", payload: {} });
    await manager.ackCommand(cmd.commandId);

    const pending = await manager.getPendingCommands();
    expect(pending.length).toBe(0);
  });

  it("completeCommand marks as completed", async () => {
    const cmd = await manager.enqueueCommand({ type: "exec", payload: {} });
    await manager.completeCommand(cmd.commandId, { status: "success", payload: { result: "ok" } });

    const pending = await manager.getPendingCommands();
    expect(pending.length).toBe(0);
  });

  it("heartbeat resets alarm and updates status", async () => {
    await manager.handleHeartbeat({ status: "healthy", sandbox_ids: ["sbx_1"] });
    const status = await storage.get("status");
    expect(status).toBe("healthy");
    const alarm = await storage.getAlarm();
    expect(alarm).not.toBeNull();
  });

  it("alarm marks node offline when heartbeat is stale", async () => {
    await manager.handleHeartbeat({ status: "healthy", sandbox_ids: ["sbx_1"] });
    clock.advance(70000); // 70s > 60s timeout
    await manager.alarm();
    const status = await storage.get("status");
    expect(status).toBe("offline");
  });

  it("alarm does not mark offline if heartbeat is recent", async () => {
    await manager.handleHeartbeat({ status: "healthy", sandbox_ids: [] });
    clock.advance(30000); // 30s < 60s timeout
    await manager.handleHeartbeat({ status: "healthy", sandbox_ids: [] });
    clock.advance(30000); // total 60s but last heartbeat was 30s ago
    await manager.alarm();
    const status = await storage.get("status");
    expect(status).toBe("healthy");
  });
});
