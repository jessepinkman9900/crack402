// Install AWS polyfills (DOMParser + Node constants) for AWS SDK compatibility in Cloudflare Workers
// Must be imported before any AWS SDK imports
import { installAWSPolyfills } from "./lib/polyfills/dom-parser";
installAWSPolyfills();

import { OpenAPIHono } from "@hono/zod-openapi";
import { Hono } from "hono";
import type { Env } from "./types";
import { createAuth } from "./lib/auth";
import { runMigrations } from "./lib/migrate";
import { createCorsMiddleware } from "./middleware/cors";
import { authMiddleware, requireUser } from "./middleware/auth";

import usersRoutes from "./routes/users";
import sshKeysRoutes from "./routes/ssh-keys";

// Sandbox API imports
import { requestIdMiddleware } from "./middleware/request-id";
import { sandboxAuthMiddleware } from "./middleware/sandbox-auth";
import { nodeAuthMiddleware } from "./middleware/node-auth";
import { operatorAuthMiddleware } from "./middleware/operator-auth";
import sandboxRoutes from "./routes/sandboxes/sandboxes";
import lifecycleRoutes from "./routes/sandboxes/lifecycle";
import execRoutes from "./routes/sandboxes/exec";
import filesRoutes from "./routes/sandboxes/files";
import snapshotsRoutes from "./routes/sandboxes/snapshots";
import portsRoutes from "./routes/sandboxes/ports";
import webhooksRoutes from "./routes/sandboxes/webhooks";
import nodeInternalRoutes, { nodeRegisterApp } from "./routes/nodes/internal";
import mgmtNodesRoutes from "./routes/mgmt/nodes";
import mgmtFleetRoutes from "./routes/mgmt/fleet";
import mgmtTenantsRoutes from "./routes/mgmt/tenants";
import obsEventsRoutes from "./routes/obs/events";
import obsBillingRoutes from "./routes/obs/billing";
import obsAuditRoutes from "./routes/obs/audit";
import obsMetricsRoutes from "./routes/obs/metrics";
import obsSandboxMetricsRoutes from "./routes/obs/metrics-sandboxes";
import obsExecMetricsRoutes from "./routes/obs/metrics-executions";
import obsUsageMetricsRoutes from "./routes/obs/metrics-usage";


// Export Durable Objects for Cloudflare Workers
export { GlobalSchedulerDO } from "./durable-objects/global-scheduler";
export { NodeManagerDO } from "./durable-objects/node-manager";
export { SandboxTrackerDO } from "./durable-objects/sandbox-tracker";
export { TenantQuotaDO } from "./durable-objects/tenant-quota";

const app = new OpenAPIHono<Env>();

// Track if migrations have run for this Worker instance
let migrationsRun = false;

// --- Global error handler ---
app.onError((err, c) => {
  console.error("[global] Unhandled error:", err);
  return c.json(
    {
      error: "Internal server error",
      ...(c.env.MOCK_EXTERNAL_SERVICES === "true"
        ? { details: String(err) }
        : {}),
    },
    500
  );
});

// --- CORS (all routes) ---
app.use("*", createCorsMiddleware());

// --- Auto-run Better-Auth migrations on startup ---
// This runs automatically on the first request to each Worker instance
app.use("*", async (c, next) => {
  if (!migrationsRun) {
    try {
      console.log("[startup] Running Better-Auth migrations...");
      await runMigrations(c.env);
      migrationsRun = true;
      console.log("[startup] Better-Auth migrations complete");
    } catch (err) {
      console.error("[startup] Migration failed:", err);
      // Continue anyway - don't block requests on migration failure
      // Better-Auth will handle missing tables gracefully or fail on specific operations
    }
  }
  return next();
});

// --- Health check (public) ---
app.get("/healthz", (c) => {
  return c.json({ status: "ok", service: "mothership-api" });
});

// --- List all routes (dev only) ---
app.get("/routes", (c) => {
  const routes = app.routes
    .filter(({ method }) => method !== "ALL")
    .map(({ method, path }) => ({ method, path }));
  return c.json(routes);
});

// --- Internal: run migrations (protected by WORKFLOW_SECRET) ---
// This endpoint allows manual migration triggering if needed
app.post("/internal/migrate", async (c) => {
  const authHeader = c.req.header("Authorization");
  const expected = `Bearer ${c.env.WORKFLOW_SECRET}`;
  if (authHeader !== expected) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  try {
    const result = await runMigrations(c.env);
    return c.json({ success: true, ...result });
  } catch (err) {
    console.error("[migrate] Error:", err);
    return c.json(
      { error: "Migration failed", details: String(err) },
      500
    );
  }
});

// --- Better-Auth handler (OAuth callbacks, session endpoints) ---
app.on(["POST", "GET"], "/api/auth/*", (c) => {
  const auth = createAuth(c.env);
  return auth.handler(c.req.raw);
});

// --- Protected v1 routes (auth required) ---
const protectedApi = new Hono<Env>();
protectedApi.use("*", authMiddleware);
protectedApi.route("/users", usersRoutes);
protectedApi.route("/ssh-keys", sshKeysRoutes);

app.route("/v1", protectedApi);

// ====== Sandbox API Routes ======

// Request ID middleware for all sandbox API routes
app.use("/v1/sandboxes/*", requestIdMiddleware);
app.use("/v1/webhooks/*", requestIdMiddleware);
app.use("/v1/internal/*", requestIdMiddleware);
app.use("/v1/mgmt/*", requestIdMiddleware);
app.use("/v1/obs/*", requestIdMiddleware);

// Workload API (tenant auth)
const sandboxApi = new OpenAPIHono<Env>();
sandboxApi.use("*", sandboxAuthMiddleware);
sandboxApi.route("/", sandboxRoutes);
sandboxApi.route("/", lifecycleRoutes);
sandboxApi.route("/", execRoutes);
sandboxApi.route("/", filesRoutes);
sandboxApi.route("/", snapshotsRoutes);
sandboxApi.route("/", portsRoutes);
app.route("/v1/sandboxes", sandboxApi);

// Webhooks (tenant auth)
const webhookApi = new OpenAPIHono<Env>();
webhookApi.use("*", sandboxAuthMiddleware);
webhookApi.route("/", webhooksRoutes);
app.route("/v1/webhooks", webhookApi);

// Node self-registration (no auth — token validated from request body)
app.route("/v1/internal/nodes", nodeRegisterApp);

// Node API (node auth)
const nodeApi = new OpenAPIHono<Env>();
nodeApi.use("*", nodeAuthMiddleware);
nodeApi.route("/", nodeInternalRoutes);
app.route("/v1/internal/nodes", nodeApi);

// Management API (operator auth)
const mgmtApi = new OpenAPIHono<Env>();
mgmtApi.use("*", operatorAuthMiddleware);
mgmtApi.route("/nodes", mgmtNodesRoutes);
mgmtApi.route("/fleet", mgmtFleetRoutes);
mgmtApi.route("/tenants", mgmtTenantsRoutes);
app.route("/v1/mgmt", mgmtApi);

// Observability API (tenant auth)
const obsApi = new OpenAPIHono<Env>();
obsApi.use("*", sandboxAuthMiddleware);
obsApi.route("/events", obsEventsRoutes);
obsApi.route("/billing", obsBillingRoutes);
obsApi.route("/audit", obsAuditRoutes);
obsApi.route("/fleet/metrics", obsMetricsRoutes);
obsApi.route("/metrics/sandboxes", obsSandboxMetricsRoutes);
obsApi.route("/metrics/executions", obsExecMetricsRoutes);
obsApi.route("/metrics/usage", obsUsageMetricsRoutes);
app.route("/v1/obs", obsApi);

// --- OpenAPI spec endpoint ---
app.doc("/openapi.json", {
  openapi: "3.1.0",
  info: {
    title: "Crack402 Sandbox API",
    version: "1.0.0",
    description: "API for managing cloud sandboxes with x402 payment support",
  },
  servers: [{ url: "https://api.crack402.com" }],
  security: [],
  "x-tagGroups": [
    { name: "Sandboxes", tags: ["Sandboxes", "Webhooks"] },
    { name: "Management", tags: ["Management (Nodes)", "Management (Fleet)", "Management (Tenants)"] }, // "Tenants" tag maps to the org-backed mgmt routes
    { name: "Observability", tags: ["Observability"] },
    { name: "Internal", tags: ["Internal (Node)"] },
  ],
} as any);

// --- OpenAPI security schemes (registered on the registry) ---
app.openAPIRegistry.registerComponent("securitySchemes", "TenantApiKey", {
  type: "apiKey",
  in: "header",
  name: "X-API-Key",
  description: "Tenant API key for sandbox operations",
});
app.openAPIRegistry.registerComponent("securitySchemes", "NodeToken", {
  type: "apiKey",
  in: "header",
  name: "Authorization",
  description: "Node bootstrap token (Bearer)",
});
app.openAPIRegistry.registerComponent("securitySchemes", "OperatorApiKey", {
  type: "apiKey",
  in: "header",
  name: "X-Operator-Key",
  description: "Operator API key for management operations",
});
app.openAPIRegistry.registerComponent("securitySchemes", "SiweSession", {
  type: "apiKey",
  in: "cookie",
  name: "better-auth.session_token",
  description: "Session obtained via SIWE (Sign-In with Ethereum). Call POST /api/auth/siwe/nonce then POST /api/auth/siwe/verify.",
});
app.openAPIRegistry.registerComponent("securitySchemes", "BetterAuthApiKey", {
  type: "apiKey",
  in: "header",
  name: "X-API-Key",
  description: "better-auth API key (mship_... prefix). Generate after signing in via GitHub or SIWE.",
});

// --- 404 fallback ---
app.notFound((c) => {
  return c.json({ error: "Not found" }, 404);
});

// Log all registered routes
console.log("\n[routes]");
app.routes.forEach(({ method, path }) => {
  if (method !== "ALL") console.log(`  ${method.padEnd(7)} ${path}`);
});
console.log("");

export default app;
