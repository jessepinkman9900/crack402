import type { PolarAdapter } from "../types";

/**
 * Mock Polar adapter.
 * Returns fake subscription and checkout data.
 */
export const mockPolar: PolarAdapter = {
  async getSubscription(_userId) {
    // In mock mode, every user has an active subscription
    return {
      id: `mock-sub-${crypto.randomUUID().slice(0, 8)}`,
      status: "active",
      plan: "pro",
      currentPeriodEnd: new Date(
        Date.now() + 30 * 24 * 60 * 60 * 1000
      ).toISOString(),
    };
  },

  async createCheckoutUrl(opts) {
    return {
      url: `https://mock-polar.example.com/checkout?plan=${opts.plan}&user=${opts.userId}`,
      id: `mock-checkout-${crypto.randomUUID().slice(0, 8)}`,
    };
  },
};
