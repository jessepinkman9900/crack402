import { createMiddleware } from "hono/factory";
import type { Env } from "../types";
import { apiError } from "../schemas/error";

/**
 * Tenant auth middleware for the Workload API.
 * Validates Bearer token or X-API-Key header against KV TENANT_KEYS.
 * Sets c.var.tenantId on success.
 */
export const sandboxAuthMiddleware = createMiddleware<Env>(async (c, next) => {
  // Check DISABLE_AUTH for development
  if (c.env.DISABLE_AUTH === "true") {
    c.set("tenantId", "ten_dev_default_tenant00");
    return next();
  }

  const apiKey = c.req.header("X-API-Key");
  const authHeader = c.req.header("Authorization");

  let token: string | undefined;

  if (apiKey) {
    token = apiKey;
  } else if (authHeader?.startsWith("Bearer ")) {
    token = authHeader.slice(7);
  }

  if (!token) {
    return c.json(
      apiError("unauthorized", "Missing authentication. Provide X-API-Key header or Bearer token."),
      401
    );
  }

  // Look up tenant ID from KV
  const tenantId = await c.env.TENANT_KEYS.get(token);
  if (!tenantId) {
    return c.json(apiError("unauthorized", "Invalid API key or token."), 401);
  }

  c.set("tenantId", tenantId);
  return next();
});
