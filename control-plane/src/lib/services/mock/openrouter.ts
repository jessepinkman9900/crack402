import type { OpenRouterAdapter } from "../types";

/**
 * Mock OpenRouter adapter.
 * Returns fake provisioning keys.
 */
export const mockOpenRouter: OpenRouterAdapter = {
  async provisionKey(opts) {
    const id = `mock-or-key-${crypto.randomUUID().slice(0, 8)}`;
    return {
      id,
      key: `sk-or-v1-mock-${crypto.randomUUID().replace(/-/g, "")}`,
      name: opts.name,
      limit: opts.monthlyLimit,
    };
  },

  async revokeKey(_keyId) {
    // No-op in mock mode
  },
};
