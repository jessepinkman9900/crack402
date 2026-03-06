import { createMiddleware } from "hono/factory";
import type { Env } from "../types";
import { apiError } from "../schemas/error";

/**
 * Operator auth middleware for the Management API.
 * Validates operator-scoped API key.
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

  if (!token) {
    return c.json(apiError("unauthorized", "Missing operator authentication."), 401);
  }

  if (token !== c.env.OPERATOR_API_KEY && token !== c.env.WORKFLOW_SECRET) {
    return c.json(apiError("forbidden", "Invalid operator credentials."), 403);
  }

  c.set("tenantId", "operator");
  return next();
});
