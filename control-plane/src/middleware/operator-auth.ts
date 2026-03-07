import { createMiddleware } from "hono/factory";
import type { Env } from "../types";
import { apiError } from "../schemas/error";
import { createAuth } from "../lib/auth";
import { getUserRoleFromApiKey, getUserRoleFromSession } from "../lib/check-role";

const MGMT_ALLOWED_ROLES = new Set(["infra-manager", "admin"]);

/**
 * Operator auth middleware for the Management API.
 * Auth order:
 *   1. OPERATOR_API_KEY or WORKFLOW_SECRET — static token, backwards compat
 *   2. mship_ API key — Better-Auth user, role must be infra-manager or admin
 *   3. Session cookie / Bearer session — Better-Auth user, role must be infra-manager or admin
 * Sets c.var.tenantId = "operator" on success.
 */
export const operatorAuthMiddleware = createMiddleware<Env>(async (c, next) => {
  if (c.env.DISABLE_AUTH === "true") {
    c.set("tenantId", "operator");
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

  // 1. Static operator tokens (backwards compat)
  if (token && (token === c.env.OPERATOR_API_KEY || token === c.env.WORKFLOW_SECRET)) {
    c.set("tenantId", "operator");
    return next();
  }

  // 2. Better-Auth mship_ API key with infra-manager or admin role
  if (token?.startsWith("mship_")) {
    const auth = createAuth(c.env);
    const result = await getUserRoleFromApiKey(c.env, auth, token);

    if (!result) {
      return c.json(apiError("unauthorized", "Invalid API key."), 401);
    }

    if (!MGMT_ALLOWED_ROLES.has(result.role)) {
      return c.json(apiError("forbidden", "Insufficient role for this API."), 403);
    }

    c.set("tenantId", "operator");
    return next();
  }

  // 3. Session cookie or Bearer session token
  if (!token) {
    const auth = createAuth(c.env);
    const result = await getUserRoleFromSession(c.env, auth, c.req.raw.headers);

    if (result) {
      if (!MGMT_ALLOWED_ROLES.has(result.role)) {
        return c.json(apiError("forbidden", "Insufficient role for this API."), 403);
      }
      c.set("tenantId", "operator");
      return next();
    }
  }

  return c.json(apiError("unauthorized", "Missing operator authentication."), 401);
});
