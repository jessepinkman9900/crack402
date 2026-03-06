import { describe, it, expect, beforeEach } from "vitest";
import { GlobalSchedulerDO, type NodeCapacity } from "../../src/durable-objects/global-scheduler";
import { InMemoryDOStorage } from "../helpers/in-memory-storage";
import { realClock } from "../../src/lib/clock";

describe("GlobalSchedulerDO", () => {
  let scheduler: GlobalSchedulerDO;
  let storage: InMemoryDOStorage;

  beforeEach(() => {
    storage = new InMemoryDOStorage();
    scheduler = new GlobalSchedulerDO({} as any, {});
    scheduler.initForTest(storage, realClock);
  });

  function makeNode(overrides: Partial<NodeCapacity> = {}): NodeCapacity {
    return {
      nodeId: "node_test123456789012345",
      totalVcpu: 16,
      usedVcpu: 0,
      totalMemoryMb: 32768,
      usedMemoryMb: 0,
      sandboxCount: 0,
      status: "healthy",
      region: "us-east-1",
      lastHeartbeat: Date.now(),
      ...overrides,
    };
  }

  it("places on a healthy node with capacity", async () => {
    await scheduler.updateNode(makeNode({ nodeId: "node_a" }));
    const result = await scheduler.placeSandbox({ vcpu: 2, memoryMb: 2048 });
    expect(result).not.toBeNull();
    expect(result!.nodeId).toBe("node_a");
  });

  it("returns null when no nodes exist", async () => {
    const result = await scheduler.placeSandbox({ vcpu: 2, memoryMb: 2048 });
    expect(result).toBeNull();
  });

  it("returns null when all nodes are at capacity", async () => {
    await scheduler.updateNode(makeNode({ nodeId: "node_a", usedVcpu: 16, usedMemoryMb: 32768 }));
    const result = await scheduler.placeSandbox({ vcpu: 2, memoryMb: 2048 });
    expect(result).toBeNull();
  });

  it("skips draining nodes", async () => {
    await scheduler.updateNode(makeNode({ nodeId: "node_a", status: "draining" }));
    await scheduler.updateNode(makeNode({ nodeId: "node_b", status: "healthy" }));
    const result = await scheduler.placeSandbox({ vcpu: 2, memoryMb: 2048 });
    expect(result).not.toBeNull();
    expect(result!.nodeId).toBe("node_b");
  });

  it("skips cordoned nodes", async () => {
    await scheduler.updateNode(makeNode({ nodeId: "node_a", status: "cordoned" }));
    await scheduler.updateNode(makeNode({ nodeId: "node_b" }));
    const result = await scheduler.placeSandbox({ vcpu: 2, memoryMb: 2048 });
    expect(result!.nodeId).toBe("node_b");
  });

  it("skips offline nodes", async () => {
    await scheduler.updateNode(makeNode({ nodeId: "node_a", status: "offline" }));
    await scheduler.updateNode(makeNode({ nodeId: "node_b" }));
    const result = await scheduler.placeSandbox({ vcpu: 2, memoryMb: 2048 });
    expect(result!.nodeId).toBe("node_b");
  });

  it("bin-pack: prefers node with less free resources", async () => {
    await scheduler.updateNode(makeNode({ nodeId: "node_a", usedVcpu: 14 })); // 2 free
    await scheduler.updateNode(makeNode({ nodeId: "node_b", usedVcpu: 0 })); // 16 free
    const result = await scheduler.placeSandbox({ vcpu: 2, memoryMb: 2048 });
    expect(result!.nodeId).toBe("node_a");
  });

  it("allocateResources updates node capacity", async () => {
    await scheduler.updateNode(makeNode({ nodeId: "node_a" }));
    await scheduler.allocateResources("node_a", 4, 4096);
    const nodes = await scheduler.getAllNodes();
    const node = nodes.find((n) => n.nodeId === "node_a")!;
    expect(node.usedVcpu).toBe(4);
    expect(node.usedMemoryMb).toBe(4096);
    expect(node.sandboxCount).toBe(1);
  });

  it("releaseResources updates node capacity", async () => {
    await scheduler.updateNode(makeNode({ nodeId: "node_a", usedVcpu: 4, usedMemoryMb: 4096, sandboxCount: 1 }));
    await scheduler.releaseResources("node_a", 4, 4096);
    const nodes = await scheduler.getAllNodes();
    const node = nodes.find((n) => n.nodeId === "node_a")!;
    expect(node.usedVcpu).toBe(0);
    expect(node.usedMemoryMb).toBe(0);
    expect(node.sandboxCount).toBe(0);
  });

  it("removeNode removes from placement pool", async () => {
    await scheduler.updateNode(makeNode({ nodeId: "node_a" }));
    await scheduler.removeNode("node_a");
    const result = await scheduler.placeSandbox({ vcpu: 2, memoryMb: 2048 });
    expect(result).toBeNull();
  });

  it("prefers same region when region is specified", async () => {
    await scheduler.updateNode(makeNode({ nodeId: "node_a", region: "us-east-1" }));
    await scheduler.updateNode(makeNode({ nodeId: "node_b", region: "eu-west-1" }));
    const result = await scheduler.placeSandbox({ vcpu: 2, memoryMb: 2048, region: "eu-west-1" });
    expect(result!.nodeId).toBe("node_b");
  });
});
