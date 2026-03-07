import { createMiddleware } from "hono/factory";
import { nanoid } from "nanoid";
import type { Env, Bindings } from "../types";
import { apiError } from "../schemas/error";
import { createAuth } from "../lib/auth";
import { getUserRoleFromApiKey, getUserRoleFromSession } from "../lib/check-role";

const DEFAULT_QUOTA = {
  maxConcurrentSandboxes: 10,
  maxVcpu: 64,
  maxMemoryMb: 131072,
  status: "active",
};

/**
 * Look up the user's owner org in better-auth's organization table, or
 * auto-provision a personal org with default quota metadata.
 */
async function findOrCreateOrgForUser(env: Bindings, userId: string): Promise<string | null> {
  const existing = await env.DB.prepare(
    `SELECT o.id FROM organization o
     JOIN member m ON o.id = m.organization_id
     WHERE m.user_id = ? AND m.role = 'owner'
       AND (o.metadata IS NULL
            OR json_extract(o.metadata, '$.status') IS NULL
            OR json_extract(o.metadata, '$.status') != 'suspended')
     LIMIT 1`
  ).bind(userId).first<{ id: string }>();

  if (existing) return existing.id;

  const orgId = `org_${nanoid(20)}`;
  const now = new Date().toISOString();
  const metadata = JSON.stringify(DEFAULT_QUOTA);

  await env.DB.prepare(
    "INSERT INTO organization (id, name, slug, created_at, metadata) VALUES (?, ?, ?, ?, ?)"
  ).bind(orgId, `user-${userId}`, `user-${userId}`, now, metadata).run();

  await env.DB.prepare(
    "INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES (?, ?, ?, 'owner', ?)"
  ).bind(`mem_${nanoid(20)}`, orgId, userId, now).run();

  return orgId;
}

const SANDBOX_ALLOWED_ROLES = new Set(["user", "admin"]);

/**
 * Tenant auth middleware for the Workload API.
 * Auth order:
 *   1. better-auth API key (mship_ prefix) — validated via better-auth, role checked (user/admin)
 *   2. Tenant API key (KV) — non-mship_ prefix tokens, no role check (machine credential)
 *   3. Session cookie or Bearer session token — validated via better-auth, role checked (user/admin)
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

  // 1. better-auth API key (mship_ prefix)
  if (token?.startsWith("mship_")) {
    const auth = createAuth(c.env);
    const result = await getUserRoleFromApiKey(c.env, auth, token);

    if (!result) {
      return c.json(apiError("unauthorized", "Invalid API key."), 401);
    }

    if (!SANDBOX_ALLOWED_ROLES.has(result.role)) {
      return c.json(apiError("forbidden", "Insufficient role for this API."), 403);
    }

    const tenantId = await findOrCreateOrgForUser(c.env, result.userId);
    if (tenantId) {
      c.set("tenantId", tenantId);
      return next();
    }
    return c.json(apiError("unauthorized", "Invalid API key."), 401);
  }

  // 2. Tenant API key (KV) — any non-mship_ token, no role check (machine credential)
  if (token) {
    const tenantId = await c.env.TENANT_KEYS.get(token);
    if (tenantId) {
      c.set("tenantId", tenantId);
      return next();
    }
    // Not a tenant key — fall through to session check
  }

  // 3. Session cookie or Authorization: Bearer <session_token>
  const auth = createAuth(c.env);
  const result = await getUserRoleFromSession(c.env, auth, c.req.raw.headers);

  if (result) {
    if (!SANDBOX_ALLOWED_ROLES.has(result.role)) {
      return c.json(apiError("forbidden", "Insufficient role for this API."), 403);
    }

    const tenantId = await findOrCreateOrgForUser(c.env, result.userId);
    if (tenantId) {
      c.set("tenantId", tenantId);
      return next();
    }
  }

  return c.json(
    apiError("unauthorized", "Missing authentication. Provide X-API-Key header, Bearer token, or session cookie."),
    401
  );
});
