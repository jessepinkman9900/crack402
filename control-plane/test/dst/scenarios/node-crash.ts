import type { ScenarioConfig } from "../framework/scenario-runner";

/**
 * Nodes crash randomly mid-operation. Sandboxes on crashed nodes should
 * transition to error state.
 */
export const nodeCrash: ScenarioConfig = {
  name: "node-crash",
  steps: 300,

  async setup(world) {
    await world.addNode("us-east-1", 16, 32768);
    await world.addNode("us-east-1", 16, 32768);
    await world.addNode("eu-west-1", 8, 16384);
    await world.addTenant(20);
  },

  async generateAction(world, step) {
    const tenants = Array.from(world.tenants.keys());
    const tenantId = world.random.pick(tenants);
    const onlineNodes = world.getOnlineNodes();
    const activeSandboxes = world.getActiveSandboxes();

    // Heartbeat online nodes
    if (step % 5 === 0) {
      for (const node of onlineNodes) {
        await world.heartbeatNode(node.nodeId);
      }
    }

    await world.advanceTime(world.random.int(500, 3000));

    const roll = world.random.float();

    if (roll < 0.3) {
      // Create sandbox
      await world.createSandbox(tenantId, 2, 2048);
    } else if (roll < 0.5 && activeSandboxes.length > 0) {
      // Progress lifecycle
      const sbx = world.random.pick(activeSandboxes);
      if (sbx.status === "provisioning") {
        await world.transitionSandbox(sbx.sandboxId, "provision_complete");
      } else if (sbx.status === "ready") {
        await world.transitionSandbox(sbx.sandboxId, "exec_started");
      }
    } else if (roll < 0.65 && onlineNodes.length > 1) {
      // Crash a random node (keep at least one online)
      const node = world.random.pick(onlineNodes);
      await world.crashNode(node.nodeId);
    } else if (roll < 0.8 && activeSandboxes.length > 0) {
      // Destroy a sandbox
      const sbx = world.random.pick(activeSandboxes);
      await world.transitionSandbox(sbx.sandboxId, "destroy");
    } else {
      // Advance time significantly (simulate heartbeat timeout)
      await world.advanceTime(world.random.int(30000, 120000));
    }
  },
};
