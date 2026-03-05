// Install AWS polyfills (DOMParser + Node constants) for AWS SDK compatibility in Cloudflare Workers
// Must be imported before any AWS SDK imports
import { installAWSPolyfills } from "./lib/polyfills/dom-parser";
installAWSPolyfills();

import { Hono } from "hono";
import type { Env } from "./types";
import { createAuth } from "./lib/auth";
import { runMigrations } from "./lib/migrate";
import { createCorsMiddleware } from "./middleware/cors";
import { authMiddleware, requireUser } from "./middleware/auth";

import authRoutes from "./routes/auth";
import usersRoutes from "./routes/users";
import botsRoutes from "./routes/bots";
import botVersionsRoutes from "./routes/bot-versions";
import cloudRoutes from "./routes/cloud";
import billingRoutes from "./routes/billing";
import sshKeysRoutes from "./routes/ssh-keys";
import testAwsRoutes from "./routes/test-aws";

// Export workflow for Cloudflare Workers
export { BotProvisioningWorkflow } from "./workflows/bot-provisioning";

const app = new Hono<Env>();

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

// --- Public v1 routes (no auth) ---
app.route("/v1/cloud", cloudRoutes);
app.route("/v1/cloud", testAwsRoutes); // AWS test endpoints

// --- Protected v1 routes (auth required) ---
const protectedApi = new Hono<Env>();
protectedApi.use("*", authMiddleware);
protectedApi.route("/auth", authRoutes);
protectedApi.route("/users", usersRoutes);
protectedApi.route("/bots", botsRoutes);
protectedApi.route("/bot-versions", botVersionsRoutes);
protectedApi.route("/billing", billingRoutes);
protectedApi.route("/ssh-keys", sshKeysRoutes);

app.route("/v1", protectedApi);

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
