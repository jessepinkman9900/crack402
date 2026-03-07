import { createMiddleware } from "hono/factory";
import type { Env } from "../types";
import { apiError } from "../schemas/error";
import { createAuth } from "../lib/auth";
import { getUserRoleFromApiKey, getUserRoleFromSession } from "../lib/check-role";

const NODE_ALLOWED_ROLES = new Set(["infra-manager", "admin"]);

/**
 * Node agent auth middleware for the internal Node API.
 * Auth order:
 *   1. NODE_TOKENS KV — per-node bearer token (existing node agent auth)
 *   2. mship_ API key — Better-Auth user, role must be infra-manager or admin
 *   3. Session cookie / Bearer session — Better-Auth user, role must be infra-manager or admin
 * Sets c.var.nodeId on success.
 */
export const nodeAuthMiddleware = createMiddleware<Env>(async (c, next) => {
  if (c.env.DISABLE_AUTH === "true") {
    const nodeId = c.req.param("nodeId") || "node_dev_default_node0000";
    c.set("nodeId", nodeId);
    return next();
  }

  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json(apiError("unauthorized", "Missing node authentication token."), 401);
  }

  const token = authHeader.slice(7);

  // 1. NODE_TOKENS KV — existing node agent auth
  const nodeId = await c.env.NODE_TOKENS.get(token);
  if (nodeId) {
    c.set("nodeId", nodeId);
    return next();
  }

  // 2. Better-Auth mship_ API key with infra-manager or admin role
  if (token.startsWith("mship_")) {
    const auth = createAuth(c.env);
    const result = await getUserRoleFromApiKey(c.env, auth, token);

    if (!result) {
      return c.json(apiError("unauthorized", "Invalid API key."), 401);
    }

    if (!NODE_ALLOWED_ROLES.has(result.role)) {
      return c.json(apiError("forbidden", "Insufficient role for this API."), 403);
    }

    c.set("nodeId", "human-operator");
    return next();
  }

  // 3. Session cookie — check Authorization header for session token passed as Bearer
  // (better-auth reads session from both cookie and Authorization: Bearer <session_token>)
  const auth = createAuth(c.env);
  const result = await getUserRoleFromSession(c.env, auth, c.req.raw.headers);

  if (result) {
    if (!NODE_ALLOWED_ROLES.has(result.role)) {
      return c.json(apiError("forbidden", "Insufficient role for this API."), 403);
    }
    c.set("nodeId", "human-operator");
    return next();
  }

  return c.json(apiError("unauthorized", "Invalid node token."), 401);
});
