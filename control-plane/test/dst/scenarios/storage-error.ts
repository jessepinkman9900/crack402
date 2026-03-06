import type { ScenarioConfig } from "../framework/scenario-runner";

/**
 * Storage writes fail mid-transaction. The system should handle partial
 * failures gracefully without corrupting state.
 */
export const storageError: ScenarioConfig = {
  name: "storage-error",
  steps: 200,

  async setup(world) {
    await world.addNode("us-east-1", 16, 32768);
    await world.addTenant(15);
  },

  async generateAction(world, step) {
    const tenants = Array.from(world.tenants.keys());
    const tenantId = world.random.pick(tenants);
    const activeSandboxes = world.getActiveSandboxes();

    // Heartbeat
    if (step % 8 === 0) {
      for (const [nodeId] of world.nodes) {
        await world.heartbeatNode(nodeId);
      }
    }

    await world.advanceTime(world.random.int(500, 5000));

    const roll = world.random.float();

    if (roll < 0.35) {
      // Create — may fail due to storage errors
      try {
        await world.createSandbox(tenantId, 2, 2048);
      } catch {
        // Storage fault — expected
      }
    } else if (roll < 0.6 && activeSandboxes.length > 0) {
      // Transition — may fail
      const sbx = world.random.pick(activeSandboxes);
      try {
        if (sbx.status === "provisioning") {
          await world.transitionSandbox(sbx.sandboxId, "provision_complete");
        } else if (sbx.status === "ready") {
          await world.transitionSandbox(sbx.sandboxId, "exec_started");
        } else if (sbx.status === "running") {
          await world.transitionSandbox(sbx.sandboxId, "pause");
        }
      } catch {
        // Storage fault — expected
      }
    } else if (roll < 0.8 && activeSandboxes.length > 0) {
      // Destroy
      const sbx = world.random.pick(activeSandboxes);
      try {
        await world.transitionSandbox(sbx.sandboxId, "destroy");
      } catch {
        // Storage fault — expected
      }
    } else {
      await world.advanceTime(world.random.int(10000, 60000));
    }
  },
};
