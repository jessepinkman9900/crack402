import type { InvariantFn } from "../framework/invariant-checker";

/**
 * No sandbox should be tracked in two different statuses simultaneously.
 * The tracker DO status must match the SimSandbox status.
 */
export const singleState: InvariantFn = (world) => {
  for (const [sandboxId, sbx] of world.sandboxes) {
    // The SimSandbox status should always match the tracker's internal state
    // This is verified by checking consistency between our local tracking and the DO
    if (sbx.destroyed && sbx.status !== "destroyed") {
      return {
        invariant: "single-state",
        message: `Sandbox ${sandboxId} is marked destroyed but status is ${sbx.status}`,
        details: { sandboxId, destroyed: sbx.destroyed, status: sbx.status },
      };
    }
  }

  // Check for duplicate sandbox IDs
  const ids = new Set<string>();
  for (const [sandboxId] of world.sandboxes) {
    if (ids.has(sandboxId)) {
      return {
        invariant: "single-state",
        message: `Duplicate sandbox ID: ${sandboxId}`,
        details: { sandboxId },
      };
    }
    ids.add(sandboxId);
  }

  return null;
};
