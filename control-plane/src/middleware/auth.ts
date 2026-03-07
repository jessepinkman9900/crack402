import { createMiddleware } from "hono/factory";
import type { Env } from "../types";
import { createAuth } from "../lib/auth";

/**
 * Authentication middleware — supports 3 methods (checked in order):
 *
 * 1. API Key — `x-api-key: mship_...` header
 *    Uses Better-Auth's verifyApiKey which auto-creates a session
 *    when `enableSessionForAPIKeys` is true.
 *
 * 2. Session cookie — forwarded from the browser by the Next.js frontend.
 *    Better-Auth validates the session cookie via `auth.api.getSession()`.
 *
 * 3. Service token — `Authorization: Bearer <WORKFLOW_SECRET>` header
 *    Used for internal service-to-service calls (e.g., webhooks, cron).
 *    Sets user/session to null — downstream routes must check for this.
 *
 * After auth, `c.get("user")` and `c.get("session")` are available.
 * Returns 401 if none of the methods succeed.
 */
export const authMiddleware = createMiddleware<Env>(async (c, next) => {
  // Dev bypass — set DISABLE_AUTH=true in wrangler.toml [vars] to skip auth
  if (c.env.DISABLE_AUTH === "true") {
    c.set("user", null);
    c.set("session", null);
    return next();
  }

  const auth = createAuth(c.env);

  // --- Method 1: API Key ---
  const apiKeyHeader = c.req.header("x-api-key");
  if (apiKeyHeader) {
    try {
      const result = await auth.api.verifyApiKey({
        body: { key: apiKeyHeader },
      });

      if (result?.valid && result?.key) {
        // The API key plugin stores the userId in key.userId
        // Fetch the user record to populate context
        const userId = result.key.userId;
        if (userId) {
          const session = await auth.api.getSession({
            headers: c.req.raw.headers,
          });

          if (session?.user) {
            c.set("user", {
              id: session.user.id,
              name: session.user.name,
              email: session.user.email,
              image: session.user.image ?? null,
              role: (session.user as any).role ?? null,
            });
            c.set("session", {
              id: session.session.id,
              userId: session.session.userId,
              token: session.session.token,
              expiresAt: session.session.expiresAt,
            });
            return next();
          }

          // If enableSessionForAPIKeys didn't produce a session,
          // we still know the user — fetch from DB directly
          const userRows = await c.env.DB.prepare(
            "SELECT id, name, email, image, role FROM user WHERE id = ?"
          )
            .bind(userId)
            .all();

          if (userRows.results.length > 0) {
            const u = userRows.results[0] as any;
            c.set("user", {
              id: u.id,
              name: u.name ?? "",
              email: u.email ?? "",
              image: u.image ?? null,
              role: u.role ?? null,
            });
            c.set("session", null);
            return next();
          }
        }
      }
    } catch (err) {
      console.error("[auth] API key verification failed:", err);
    }

    return c.json({ error: "Invalid API key" }, 401);
  }

  // --- Method 2: Session cookie ---
  const cookie = c.req.header("cookie");
  if (cookie) {
    try {
      const session = await auth.api.getSession({
        headers: c.req.raw.headers,
      });

      if (session?.user) {
        c.set("user", {
          id: session.user.id,
          name: session.user.name,
          email: session.user.email,
          image: session.user.image ?? null,
          role: (session.user as any).role ?? null,
        });
        c.set("session", {
          id: session.session.id,
          userId: session.session.userId,
          token: session.session.token,
          expiresAt: session.session.expiresAt,
        });
        return next();
      }
    } catch (err) {
      console.error("[auth] Session validation failed:", err);
    }
  }

  // --- Method 3: Service token (internal) ---
  const authHeader = c.req.header("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    if (token === c.env.WORKFLOW_SECRET) {
      // Service-to-service call — no user context
      c.set("user", null);
      c.set("session", null);
      return next();
    }
  }

  return c.json({ error: "Unauthorized" }, 401);
});

/**
 * Require that the request has an authenticated user (not just a service token).
 * Use after authMiddleware on routes that need a real user.
 */
export const requireUser = createMiddleware<Env>(async (c, next) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "User authentication required" }, 403);
  }
  return next();
});
