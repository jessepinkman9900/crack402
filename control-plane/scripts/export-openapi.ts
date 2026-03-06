/**
 * Export OpenAPI spec from route definitions.
 *
 * This script builds the OpenAPI document by importing route files directly
 * (avoiding Cloudflare-specific imports like Durable Objects and Workflows).
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { OpenAPIHono } from "@hono/zod-openapi";

// Import route modules directly (these don't have CF-specific deps)
import sandboxRoutes from "../src/routes/sandboxes/sandboxes";
import lifecycleRoutes from "../src/routes/sandboxes/lifecycle";
import execRoutes from "../src/routes/sandboxes/exec";
import filesRoutes from "../src/routes/sandboxes/files";
import snapshotsRoutes from "../src/routes/sandboxes/snapshots";
import portsRoutes from "../src/routes/sandboxes/ports";
import webhooksRoutes from "../src/routes/sandboxes/webhooks";
import nodeInternalRoutes from "../src/routes/nodes/internal";
import mgmtNodesRoutes from "../src/routes/mgmt/nodes";
import mgmtFleetRoutes from "../src/routes/mgmt/fleet";
import mgmtTenantsRoutes from "../src/routes/mgmt/tenants";
import obsEventsRoutes from "../src/routes/obs/events";
import obsBillingRoutes from "../src/routes/obs/billing";
import obsAuditRoutes from "../src/routes/obs/audit";
import obsMetricsRoutes from "../src/routes/obs/metrics";

const app = new OpenAPIHono();

// Mount routes with the same paths as index.ts
const sandboxApi = new OpenAPIHono();
sandboxApi.route("/", sandboxRoutes);
sandboxApi.route("/", lifecycleRoutes);
sandboxApi.route("/", execRoutes);
sandboxApi.route("/", filesRoutes);
sandboxApi.route("/", snapshotsRoutes);
sandboxApi.route("/", portsRoutes);
app.route("/v1/sandboxes", sandboxApi);

const webhookApi = new OpenAPIHono();
webhookApi.route("/", webhooksRoutes);
app.route("/v1/webhooks", webhookApi);

const nodeApi = new OpenAPIHono();
nodeApi.route("/", nodeInternalRoutes);
app.route("/v1/internal/nodes", nodeApi);

const mgmtApi = new OpenAPIHono();
mgmtApi.route("/nodes", mgmtNodesRoutes);
mgmtApi.route("/fleet", mgmtFleetRoutes);
mgmtApi.route("/tenants", mgmtTenantsRoutes);
app.route("/v1/mgmt", mgmtApi);

const obsApi = new OpenAPIHono();
obsApi.route("/events", obsEventsRoutes);
obsApi.route("/billing", obsBillingRoutes);
obsApi.route("/audit", obsAuditRoutes);
obsApi.route("/fleet/metrics", obsMetricsRoutes);
app.route("/v1/obs", obsApi);

// Register security schemes
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

const spec = app.getOpenAPIDocument({
  openapi: "3.1.0",
  info: {
    title: "Crack402 Sandbox API",
    version: "1.0.0",
    description: "API for managing cloud sandboxes with x402 payment support",
  },
  servers: [{ url: "https://api.crack402.com" }],
});

const outPath = resolve(import.meta.dir, "../../docs/openapi.json");
writeFileSync(outPath, JSON.stringify(spec, null, 2));

// Count operations
const opCount = Object.values(spec.paths || {}).reduce(
  (sum: number, methods: any) => sum + Object.keys(methods).length,
  0
);
console.log(`OpenAPI spec written to ${outPath}`);
console.log(`Operations: ${opCount}`);
