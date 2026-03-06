import type { InvariantFn } from "../framework/invariant-checker";

/**
 * Once a sandbox reaches "destroyed", it must never transition to any other state.
 */
export const noResurrection: InvariantFn = (world) => {
  for (const [sandboxId, sbx] of world.sandboxes) {
    if (sbx.destroyed && sbx.status !== "destroyed") {
      return {
        invariant: "no-resurrection",
        message: `Sandbox ${sandboxId} was destroyed but is now in state ${sbx.status}`,
        details: { sandboxId, status: sbx.status },
      };
    }
  }
  return null;
};
