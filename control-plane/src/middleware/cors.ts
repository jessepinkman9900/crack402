import { cors } from "hono/cors";
import type { Env } from "../types";

/**
 * CORS middleware — allows the Next.js frontend to call the API.
 *
 * In production, FRONTEND_URL restricts the origin.
 * In development, localhost origins are also allowed.
 */
export function createCorsMiddleware() {
  return cors<Env>({
    origin: (origin, c) => {
      const frontendUrl = c.env.FRONTEND_URL;

      // Allow the configured frontend origin
      if (origin === frontendUrl) {
        return origin;
      }

      // Allow localhost origins for development
      if (
        origin.startsWith("http://localhost:") ||
        origin.startsWith("http://127.0.0.1:")
      ) {
        return origin;
      }

      return null; // Reject
    },
    allowHeaders: [
      "Content-Type",
      "Authorization",
      "x-api-key",
      "Cookie",
    ],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    exposeHeaders: ["Set-Cookie"],
    credentials: true,
    maxAge: 600, // Cache preflight for 10 minutes
  });
}
