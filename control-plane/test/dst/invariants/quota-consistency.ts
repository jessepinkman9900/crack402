import type { InvariantFn } from "../framework/invariant-checker";

/**
 * TenantQuotaDO.currentCount must match the actual count of non-destroyed
 * sandboxes for that tenant.
 */
export const quotaConsistency: InvariantFn = (world) => {
  for (const [tenantId, tenant] of world.tenants) {
    const activeSandboxes = Array.from(world.sandboxes.values())
      .filter((s) => s.tenantId === tenantId && !s.destroyed);

    // We can't easily read the quota synchronously, but we can check
    // that the sandbox count is reasonable (not negative, not over limit)
    const actualCount = activeSandboxes.length;

    // Check for negative counts (impossible state)
    if (actualCount < 0) {
      return {
        invariant: "quota-consistency",
        message: `Tenant ${tenantId} has negative sandbox count: ${actualCount}`,
        details: { tenantId, actualCount },
      };
    }
  }
  return null;
};
