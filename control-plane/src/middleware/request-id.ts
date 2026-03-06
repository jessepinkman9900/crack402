import { createMiddleware } from "hono/factory";
import type { Env } from "../types";

export const requestIdMiddleware = createMiddleware<Env>(async (c, next) => {
  const id = c.req.header("X-Request-Id") || crypto.randomUUID();
  c.set("requestId", id);
  c.header("X-Request-Id", id);
  await next();
});
