import type { PolarAdapter } from "./types";
import type { Bindings } from "../../types";

/**
 * Real Polar adapter (stub).
 * Will be implemented when Polar integration is ready.
 */
export function createPolarAdapter(_env: Bindings): PolarAdapter {
  return {
    async getSubscription(_userId) {
      // TODO: Implement real Polar API call
      return null;
    },

    async createCheckoutUrl(opts) {
      // TODO: Implement real Polar checkout
      throw new Error("Polar checkout not yet implemented");
    },
  };
}
