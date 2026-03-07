import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    globals: true,
    include: ["test/auth/**/*.test.ts"],
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
            // Override wrangler.toml DISABLE_AUTH=true so auth is actually enforced
            DISABLE_AUTH: "false",
            BETTER_AUTH_SECRET: "test-secret-at-least-32-characters-long",
            GITHUB_CLIENT_ID: "test-github-client-id",
            GITHUB_CLIENT_SECRET: "test-github-client-secret",
          },
        },
      },
    },
  },
});
