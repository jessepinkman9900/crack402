import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    globals: true,
    include: ["test/e2e/**/*.test.ts"],
    poolOptions: {
      workers: {
        isolatedStorage: false,
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          durableObjects: {
            GLOBAL_SCHEDULER: "GlobalSchedulerDO",
            NODE_MANAGER: "NodeManagerDO",
            SANDBOX_TRACKER: "SandboxTrackerDO",
            TENANT_QUOTA: "TenantQuotaDO",
          },
          kvNamespaces: ["TENANT_KEYS", "NODE_TOKENS"],
          r2Buckets: ["SNAPSHOTS"],
          bindings: {
            DISABLE_AUTH: "true",
          },
        },
      },
    },
  },
});
