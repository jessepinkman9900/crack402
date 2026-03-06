import type { ScenarioConfig } from "../framework/scenario-runner";
import type { SandboxEvent } from "../../../src/state-machine/sandbox-states";

/**
 * Rapid state changes: create→destroy immediately, quick start/stop cycles.
 * Tests that the state machine handles rapid transitions correctly.
 */
export const rapidTransitions: ScenarioConfig = {
  name: "rapid-transitions",
  steps: 500,

  async setup(world) {
    await world.addNode("us-east-1", 32, 65536);
    await world.addTenant(50);
  },

  async generateAction(world, step) {
    const tenants = Array.from(world.tenants.keys());
    const tenantId = world.random.pick(tenants);
    const activeSandboxes = world.getActiveSandboxes();

    // Heartbeat periodically
    if (step % 20 === 0) {
      for (const [nodeId] of world.nodes) {
        await world.heartbeatNode(nodeId);
      }
    }

    // Minimal time advance
    await world.advanceTime(world.random.int(1, 100));

    const roll = world.random.float();

    if (roll < 0.3) {
      // Create and immediately destroy
      const result = await world.createSandbox(tenantId, 1, 512);
      if ("sandboxId" in result) {
        await world.transitionSandbox(result.sandboxId, "destroy");
      }
    } else if (roll < 0.5) {
      // Create, provision, start, stop rapidly
      const result = await world.createSandbox(tenantId, 1, 512);
      if ("sandboxId" in result) {
        await world.transitionSandbox(result.sandboxId, "provision_complete");
        await world.transitionSandbox(result.sandboxId, "exec_started");
        await world.transitionSandbox(result.sandboxId, "stop_requested");
        await world.transitionSandbox(result.sandboxId, "stop_complete");
        await world.transitionSandbox(result.sandboxId, "destroy");
      }
    } else if (roll < 0.7 && activeSandboxes.length > 0) {
      // Random valid event on random sandbox
      const sbx = world.random.pick(activeSandboxes);
      const validEvents: Record<string, SandboxEvent[]> = {
        provisioning: ["provision_complete", "error_occurred", "destroy"],
        ready: ["start", "exec_started", "destroy", "error_occurred"],
        running: ["pause", "stop_requested", "destroy", "error_occurred"],
        paused: ["resume", "stop_requested", "destroy", "error_occurred"],
        stopping: ["stop_complete", "error_occurred", "destroy"],
        stopped: ["start", "destroy", "error_occurred"],
        error: ["destroy", "recover"],
      };
      const events = validEvents[sbx.status] || [];
      if (events.length > 0) {
        const event = world.random.pick(events);
        await world.transitionSandbox(sbx.sandboxId, event);
      }
    } else if (activeSandboxes.length > 0) {
      // Mass destroy
      const count = Math.min(world.random.int(1, 5), activeSandboxes.length);
      for (let i = 0; i < count; i++) {
        const sbx = activeSandboxes[i];
        await world.transitionSandbox(sbx.sandboxId, "destroy");
      }
    }
  },
};
