import { describe, it, expect, beforeEach } from "vitest";
import { SandboxTrackerDO } from "../../src/durable-objects/sandbox-tracker";
import { InMemoryDOStorage } from "../helpers/in-memory-storage";
import type { Clock } from "../../src/lib/clock";

function makeClock(startMs = 1000000): Clock & { advance: (ms: number) => void; time: number } {
  const clock = {
    time: startMs,
    now() { return this.time; },
    isoNow() { return new Date(this.time).toISOString(); },
    advance(ms: number) { this.time += ms; },
  };
  return clock;
}

describe("SandboxTrackerDO", () => {
  let tracker: SandboxTrackerDO;
  let storage: InMemoryDOStorage;
  let clock: ReturnType<typeof makeClock>;

  const sandboxConfig = {
    sandboxId: "sbx_test1234567890123456",
    tenantId: "ten_test1234567890123456",
    nodeId: "node_test123456789012345",
    baseImage: "python:3.12-slim",
    vcpu: 2,
    memoryMb: 2048,
    gpu: null,
    timeoutSeconds: 3600,
    idleTimeoutSeconds: 600,
    autoPauseOnIdle: false,
    autoDestroy: true,
  };

  beforeEach(() => {
    storage = new InMemoryDOStorage();
    clock = makeClock();
    tracker = new SandboxTrackerDO({} as any, {});
    tracker.initForTest(storage, clock);
  });

  it("init sets state to provisioning", async () => {
    await tracker.initSandbox(sandboxConfig);
    const state = await tracker.getState();
    expect(state!.status).toBe("provisioning");
    expect(state!.sandboxId).toBe(sandboxConfig.sandboxId);
  });

  it("provision_complete transitions to ready", async () => {
    await tracker.initSandbox(sandboxConfig);
    const result = await tracker.handleTransition("provision_complete");
    expect("newState" in result).toBe(true);
    if ("newState" in result) {
      expect(result.newState).toBe("ready");
    }
  });

  it("start transitions ready → running and starts billing", async () => {
    await tracker.initSandbox(sandboxConfig);
    await tracker.handleTransition("provision_complete");
    const result = await tracker.handleTransition("start");
    if ("newState" in result) {
      expect(result.newState).toBe("running");
    }
    const state = await tracker.getState();
    expect(state!.billingStartedAt).toBe(clock.time);
  });

  it("pause stops billing and records billed time", async () => {
    await tracker.initSandbox(sandboxConfig);
    await tracker.handleTransition("provision_complete");
    await tracker.handleTransition("start");
    clock.advance(10000); // 10 seconds
    await tracker.handleTransition("pause");

    const state = await tracker.getState();
    expect(state!.status).toBe("paused");
    expect(state!.billingStartedAt).toBeNull();
    expect(state!.totalBilledMs).toBe(10000);
  });

  it("getBillingTotal calculates running cost", async () => {
    await tracker.initSandbox(sandboxConfig);
    await tracker.handleTransition("provision_complete");
    await tracker.handleTransition("start");
    clock.advance(60000); // 60 seconds

    const billing = await tracker.getBillingTotal();
    expect(billing.totalBilledMs).toBe(60000);
    expect(billing.isRunning).toBe(true);
    expect(billing.totalCostUsd).toBeGreaterThan(0);
  });

  it("exec activity resets idle timer", async () => {
    await tracker.initSandbox(sandboxConfig);
    await tracker.handleTransition("provision_complete");
    await tracker.handleTransition("start");

    const alarmBefore = await storage.getAlarm();
    clock.advance(5000);
    await tracker.recordExecActivity();
    const alarmAfter = await storage.getAlarm();

    // Alarm should be reset to a later time
    expect(alarmAfter).toBeGreaterThan(alarmBefore!);
  });

  it("invalid transition returns error", async () => {
    await tracker.initSandbox(sandboxConfig);
    const result = await tracker.handleTransition("start");
    // provisioning + start is invalid
    expect("error" in result).toBe(true);
  });

  it("returns error when not initialized", async () => {
    const result = await tracker.handleTransition("start");
    expect("error" in result).toBe(true);
  });

  it("destroy from running stops billing and releases resources", async () => {
    await tracker.initSandbox(sandboxConfig);
    await tracker.handleTransition("provision_complete");
    await tracker.handleTransition("start");
    clock.advance(5000);
    const result = await tracker.handleTransition("destroy");
    if ("newState" in result) {
      expect(result.newState).toBe("destroyed");
      // Should have stop_billing_meter, update_scheduler release, update_quota effects
      const effectTypes = result.effects.map((e) => e.type);
      expect(effectTypes).toContain("stop_billing_meter");
      expect(effectTypes).toContain("update_scheduler");
      expect(effectTypes).toContain("update_quota");
    }
    const state = await tracker.getState();
    expect(state!.billingStartedAt).toBeNull();
    expect(state!.totalBilledMs).toBe(5000);
  });
});
