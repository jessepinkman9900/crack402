import type { ScenarioConfig } from "../framework/scenario-runner";
import type { SandboxEvent } from "../../../src/state-machine/sandbox-states";

/**
 * Normal create → provision_complete → exec → snapshot → destroy cycles.
 * Tests the basic lifecycle without faults.
 */
export const happyPath: ScenarioConfig = {
  name: "happy-path",
  steps: 500,

  async setup(world) {
    await world.addNode("us-east-1", 16, 32768);
    await world.addNode("us-east-1", 16, 32768);
    await world.addTenant(10);
  },

  async generateAction(world, step) {
    const tenants = Array.from(world.tenants.keys());
    const tenantId = world.random.pick(tenants);
    const activeSandboxes = world.getActiveSandboxes();

    // Periodically heartbeat all nodes
    if (step % 10 === 0) {
      for (const [nodeId] of world.nodes) {
        await world.heartbeatNode(nodeId);
      }
    }

    // Advance time a little
    await world.advanceTime(world.random.int(100, 5000));

    // Decide action
    const roll = world.random.float();

    if (roll < 0.25 || activeSandboxes.length === 0) {
      // Create a new sandbox
      await world.createSandbox(tenantId, 2, 2048);
    } else if (roll < 0.5) {
      // Progress a sandbox through lifecycle
      const sbx = world.random.pick(activeSandboxes);
      const progressEvents: Record<string, SandboxEvent> = {
        provisioning: "provision_complete",
        ready: "exec_started",
        running: "pause",
        paused: "resume",
        stopping: "stop_complete",
        stopped: "start",
        error: "recover",
      };
      const event = progressEvents[sbx.status];
      if (event) {
        await world.transitionSandbox(sbx.sandboxId, event);
      }
    } else if (roll < 0.7) {
      // Exec activity on a running sandbox
      const running = world.getSandboxesByStatus("running");
      if (running.length > 0) {
        const sbx = world.random.pick(running);
        await world.execActivity(sbx.sandboxId);
      }
    } else if (roll < 0.9) {
      // Destroy a sandbox
      const sbx = world.random.pick(activeSandboxes);
      await world.transitionSandbox(sbx.sandboxId, "destroy");
    } else {
      // Advance more time
      await world.advanceTime(world.random.int(10000, 60000));
    }
  },
};
