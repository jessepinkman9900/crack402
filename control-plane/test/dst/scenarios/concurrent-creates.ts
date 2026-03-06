import type { ScenarioConfig } from "../framework/scenario-runner";

/**
 * Multiple tenants creating sandboxes simultaneously.
 * Tests quota enforcement and scheduler correctness under load.
 */
export const concurrentCreates: ScenarioConfig = {
  name: "concurrent-creates",
  steps: 400,

  async setup(world) {
    await world.addNode("us-east-1", 32, 65536);
    await world.addNode("us-east-1", 32, 65536);

    // Multiple tenants with small quotas
    for (let i = 0; i < 5; i++) {
      await world.addTenant(5); // 5 concurrent max
    }
  },

  async generateAction(world, step) {
    const tenants = Array.from(world.tenants.keys());
    const activeSandboxes = world.getActiveSandboxes();

    // Heartbeat
    if (step % 15 === 0) {
      for (const [nodeId] of world.nodes) {
        await world.heartbeatNode(nodeId);
      }
    }

    await world.advanceTime(world.random.int(100, 1000));

    const roll = world.random.float();

    if (roll < 0.5) {
      // Multiple tenants create simultaneously
      const tenantId = world.random.pick(tenants);
      await world.createSandbox(tenantId, world.random.int(1, 4), world.random.int(512, 4096));
    } else if (roll < 0.7 && activeSandboxes.length > 0) {
      // Progress some through lifecycle
      const sbx = world.random.pick(activeSandboxes);
      if (sbx.status === "provisioning") {
        await world.transitionSandbox(sbx.sandboxId, "provision_complete");
      } else if (sbx.status === "ready") {
        await world.transitionSandbox(sbx.sandboxId, "exec_started");
      }
    } else if (roll < 0.9 && activeSandboxes.length > 0) {
      // Destroy some to free up quota
      const sbx = world.random.pick(activeSandboxes);
      await world.transitionSandbox(sbx.sandboxId, "destroy");
    } else {
      await world.advanceTime(world.random.int(5000, 20000));
    }
  },
};
