import { describe, it, expect, beforeEach } from "vitest";
import { TenantQuotaDO } from "../../src/durable-objects/tenant-quota";
import { InMemoryDOStorage } from "../helpers/in-memory-storage";

describe("TenantQuotaDO", () => {
  let quota: TenantQuotaDO;
  let storage: InMemoryDOStorage;

  beforeEach(() => {
    storage = new InMemoryDOStorage();
    quota = new TenantQuotaDO({} as any, {});
    quota.initForTest(storage);
  });

  it("allows creation within limits", async () => {
    await quota.initQuota({ maxConcurrentSandboxes: 5, maxVcpu: 32, maxMemoryMb: 65536 });
    const result = await quota.checkAndReserve(2, 2048);
    expect(result.allowed).toBe(true);
  });

  it("rejects when concurrent sandbox limit is reached", async () => {
    await quota.initQuota({ maxConcurrentSandboxes: 1, maxVcpu: 32, maxMemoryMb: 65536 });
    await quota.checkAndReserve(2, 2048);
    const result = await quota.checkAndReserve(2, 2048);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Concurrent sandbox limit");
  });

  it("rejects when vCPU limit is exceeded", async () => {
    await quota.initQuota({ maxConcurrentSandboxes: 10, maxVcpu: 4, maxMemoryMb: 65536 });
    await quota.checkAndReserve(2, 2048);
    const result = await quota.checkAndReserve(4, 2048);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("vCPU limit");
  });

  it("rejects when memory limit is exceeded", async () => {
    await quota.initQuota({ maxConcurrentSandboxes: 10, maxVcpu: 64, maxMemoryMb: 4096 });
    await quota.checkAndReserve(2, 2048);
    const result = await quota.checkAndReserve(2, 4096);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Memory limit");
  });

  it("release decrements counters", async () => {
    await quota.initQuota({ maxConcurrentSandboxes: 2, maxVcpu: 8, maxMemoryMb: 8192 });
    await quota.checkAndReserve(2, 2048);
    await quota.checkAndReserve(2, 2048);
    // At limit
    const blocked = await quota.checkAndReserve(2, 2048);
    expect(blocked.allowed).toBe(false);
    // Release one
    await quota.release(2, 2048);
    const allowed = await quota.checkAndReserve(2, 2048);
    expect(allowed.allowed).toBe(true);
  });

  it("auto-initializes with defaults when not initialized", async () => {
    const result = await quota.checkAndReserve(2, 2048);
    expect(result.allowed).toBe(true);
  });

  it("getQuota returns current state", async () => {
    await quota.initQuota({ maxConcurrentSandboxes: 5, maxVcpu: 16, maxMemoryMb: 32768 });
    await quota.checkAndReserve(4, 8192);
    const state = await quota.getQuota();
    expect(state!.currentCount).toBe(1);
    expect(state!.usedVcpu).toBe(4);
    expect(state!.usedMemoryMb).toBe(8192);
  });

  it("release never goes below zero", async () => {
    await quota.initQuota();
    await quota.release(100, 100000);
    const state = await quota.getQuota();
    expect(state!.currentCount).toBe(0);
    expect(state!.usedVcpu).toBe(0);
    expect(state!.usedMemoryMb).toBe(0);
  });

  it("updateLimits changes max values", async () => {
    await quota.initQuota({ maxConcurrentSandboxes: 5, maxVcpu: 16, maxMemoryMb: 32768 });
    await quota.updateLimits({ maxConcurrentSandboxes: 20 });
    const state = await quota.getQuota();
    expect(state!.maxConcurrentSandboxes).toBe(20);
    expect(state!.maxVcpu).toBe(16); // unchanged
  });
});
