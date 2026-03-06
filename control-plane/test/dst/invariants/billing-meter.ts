import type { InvariantFn } from "../framework/invariant-checker";

/**
 * Billing meters should only be active when a sandbox is in "running" state.
 * A sandbox that is not "running" should have billingStartedAt === null.
 */
export const billingMeter: InvariantFn = (world) => {
  for (const [sandboxId, sbx] of world.sandboxes) {
    if (sbx.destroyed) continue;

    // Read the storage directly to check billing state
    const stateData = sbx.storage.getAllData().get("state") as any;
    if (!stateData) continue;

    if (stateData.status !== "running" && stateData.billingStartedAt !== null) {
      return {
        invariant: "billing-meter",
        message: `Sandbox ${sandboxId} is in state ${stateData.status} but has active billing (billingStartedAt=${stateData.billingStartedAt})`,
        details: {
          sandboxId,
          status: stateData.status,
          billingStartedAt: stateData.billingStartedAt,
        },
      };
    }

    if (stateData.status === "running" && stateData.billingStartedAt === null) {
      return {
        invariant: "billing-meter",
        message: `Sandbox ${sandboxId} is running but billing is not active`,
        details: { sandboxId, status: stateData.status },
      };
    }
  }
  return null;
};
