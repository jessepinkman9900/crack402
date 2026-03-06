import type { InvariantFn } from "../framework/invariant-checker";

/**
 * When a node is marked offline (crashed), all its sandboxes should transition
 * to "error" or "destroyed" — they cannot remain in healthy states.
 */
export const nodeFailure: InvariantFn = (world) => {
  for (const [nodeId, node] of world.nodes) {
    if (node.isOnline) continue;

    // All sandboxes on this crashed node should be in error or destroyed
    const sandboxesOnNode = Array.from(world.sandboxes.values())
      .filter((s) => s.nodeId === nodeId && !s.destroyed);

    for (const sbx of sandboxesOnNode) {
      const healthyStates = ["provisioning", "ready", "running", "paused", "stopping"];
      if (healthyStates.includes(sbx.status)) {
        return {
          invariant: "node-failure",
          message: `Node ${nodeId} is offline but sandbox ${sbx.sandboxId} is still in state ${sbx.status}`,
          details: { nodeId, sandboxId: sbx.sandboxId, status: sbx.status },
        };
      }
    }
  }
  return null;
};
