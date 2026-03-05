import { Hono } from "hono";
import type { Env } from "../types";
import { createAuth } from "../lib/auth";

/**
 * Auth / API token routes
 *
 * POST   /v1/auth/tokens         — Create a new API key
 * GET    /v1/auth/tokens         — List all API keys for the current user
 * DELETE /v1/auth/tokens/:id     — Revoke an API key
 */
const auth = new Hono<Env>();

// --- Create API key ---
auth.post("/tokens", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "User required" }, 403);

  const body = await c.req.json<{ name?: string; expiresIn?: number }>();
  const name = body.name || "default";

  const authInstance = createAuth(c.env);

  try {
    const result = await authInstance.api.createApiKey({
      body: {
        name,
        userId: user.id,
        ...(body.expiresIn ? { expiresIn: body.expiresIn } : {}),
      },
    });

    // The response contains the raw key — only shown once
    return c.json(
      {
        id: result.id,
        name: result.name,
        key: result.key, // Full key, only returned on creation
        start: result.start, // Prefix for display (e.g. "mship_abc...")
        expiresAt: result.expiresAt,
        createdAt: result.createdAt,
      },
      201
    );
  } catch (err) {
    console.error("[auth/tokens] Create failed:", err);
    return c.json({ error: "Failed to create API key" }, 500);
  }
});

// --- List API keys ---
auth.get("/tokens", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "User required" }, 403);

  try {
    // Query the apikey table directly — Better-Auth stores them here
    const rows = await c.env.DB.prepare(
      `SELECT id, name, start, "expiresAt", "createdAt", enabled
       FROM apikey
       WHERE "userId" = ?
       ORDER BY "createdAt" DESC`
    )
      .bind(user.id)
      .all();

    const tokens = rows.results.map((r: any) => ({
      id: r.id,
      name: r.name,
      start: r.start, // Masked key prefix
      expiresAt: r.expiresAt,
      createdAt: r.createdAt,
      enabled: r.enabled ?? true,
    }));

    return c.json({ tokens });
  } catch (err) {
    console.error("[auth/tokens] List failed:", err);
    return c.json({ error: "Failed to list API keys" }, 500);
  }
});

// --- Revoke API key ---
auth.delete("/tokens/:id", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "User required" }, 403);

  const tokenId = c.req.param("id");

  try {
    // Verify the key belongs to this user before deleting
    const existing = await c.env.DB.prepare(
      `SELECT id FROM apikey WHERE id = ? AND "userId" = ?`
    )
      .bind(tokenId, user.id)
      .first();

    if (!existing) {
      return c.json({ error: "API key not found" }, 404);
    }

    await c.env.DB.prepare("DELETE FROM apikey WHERE id = ?")
      .bind(tokenId)
      .run();

    return c.json({ success: true });
  } catch (err) {
    console.error("[auth/tokens] Delete failed:", err);
    return c.json({ error: "Failed to revoke API key" }, 500);
  }
});

export default auth;
