import { createMiddleware } from "hono/factory";
import type { Env } from "../types";
import { apiError } from "../schemas/error";

/**
 * Node agent auth middleware for the internal Node API.
 * Validates per-node bearer token from KV NODE_TOKENS.
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
  const nodeId = await c.env.NODE_TOKENS.get(token);

  if (!nodeId) {
    return c.json(apiError("unauthorized", "Invalid node token."), 401);
  }

  c.set("nodeId", nodeId);
  return next();
});
