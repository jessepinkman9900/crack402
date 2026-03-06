import type { ScenarioConfig } from "../framework/scenario-runner";

/**
 * DO alarms fail to fire sometimes. The system should handle this gracefully.
 * Tests timer-based transitions (TTL timeout, idle timeout) with alarm failures.
 */
export const alarmFailure: ScenarioConfig = {
  name: "alarm-failure",
  steps: 300,

  async setup(world) {
    await world.addNode("us-east-1", 16, 32768);
    await world.addTenant(20);
  },

  async generateAction(world, step) {
    const tenants = Array.from(world.tenants.keys());
    const tenantId = world.random.pick(tenants);
    const activeSandboxes = world.getActiveSandboxes();

    // Heartbeat
    if (step % 10 === 0) {
      for (const [nodeId] of world.nodes) {
        await world.heartbeatNode(nodeId);
      }
    }

    const roll = world.random.float();

    if (roll < 0.3) {
      // Create sandbox
      await world.createSandbox(tenantId, 2, 2048);
    } else if (roll < 0.5 && activeSandboxes.length > 0) {
      // Progress to running (so idle timers get armed)
      const sbx = world.random.pick(activeSandboxes);
      if (sbx.status === "provisioning") {
        await world.transitionSandbox(sbx.sandboxId, "provision_complete");
      } else if (sbx.status === "ready") {
        await world.transitionSandbox(sbx.sandboxId, "exec_started");
      }
    } else if (roll < 0.7) {
      // Advance time past timeout thresholds to trigger alarms
      // Idle timeout is 600s, TTL is 3600s
      await world.advanceTime(world.random.int(300_000, 700_000));
    } else if (roll < 0.85) {
      // Exec activity to reset idle timers
      const running = world.getSandboxesByStatus("running");
      if (running.length > 0) {
        const sbx = world.random.pick(running);
        await world.execActivity(sbx.sandboxId);
      }
    } else if (activeSandboxes.length > 3) {
      // Destroy some to prevent buildup
      const sbx = world.random.pick(activeSandboxes);
      await world.transitionSandbox(sbx.sandboxId, "destroy");
    } else {
      await world.advanceTime(world.random.int(1000, 10000));
    }
  },
};
