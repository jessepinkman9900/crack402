import { Hono } from "hono";
import type { Env } from "../types";
import { createDb, credits, usageRecords } from "../db";
import { eq, and, desc, sum } from "drizzle-orm";

/**
 * Billing routes
 *
 * GET  /v1/billing/credits — Get credit balance for the current user
 * GET  /v1/billing/usage   — Get usage records for the current user
 * POST /v1/billing/credits — Add credits (service token or admin only)
 */
const app = new Hono<Env>();

// --- Get credit balance ---
app.get("/credits", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "User required" }, 403);

  try {
    const db = createDb(c.env.DB);
    const [result] = await db
      .select({
        balance: sum(credits.amount),
      })
      .from(credits)
      .where(eq(credits.userId, user.id));

    return c.json({ balance: Number(result?.balance ?? 0) });
  } catch (err) {
    console.error("[billing/credits] Get failed:", err);
    return c.json({ error: "Failed to fetch credits" }, 500);
  }
});

// --- Add credits (typically called by webhook or service token) ---
app.post("/credits", async (c) => {
  // Allow both user-authenticated and service-token requests
  const user = c.get("user");

  const body = await c.req.json<{
    userId?: string;
    amount: number;
    source: string;
  }>();

  // If called via service token, userId must be provided in body
  // If called via user auth, userId comes from the session
  const targetUserId = user?.id ?? body.userId;

  if (!targetUserId) {
    return c.json(
      { error: "userId required (in body for service calls)" },
      400
    );
  }

  if (typeof body.amount !== "number" || body.amount === 0) {
    return c.json({ error: "amount must be a non-zero number" }, 400);
  }

  if (!body.source) {
    return c.json({ error: "source is required" }, 400);
  }

  // Non-service callers can't add credits for other users
  if (user && body.userId && body.userId !== user.id) {
    return c.json({ error: "Cannot modify credits for another user" }, 403);
  }

  const id = crypto.randomUUID();
  const now = Date.now();

  try {
    const db = createDb(c.env.DB);
    await db.insert(credits).values({
      id,
      userId: targetUserId,
      amount: body.amount,
      source: body.source,
      createdAt: now,
    });

    return c.json(
      {
        id,
        userId: targetUserId,
        amount: body.amount,
        source: body.source,
        createdAt: now,
      },
      201
    );
  } catch (err) {
    console.error("[billing/credits] Add failed:", err);
    return c.json({ error: "Failed to add credits" }, 500);
  }
});

// --- Get usage records ---
app.get("/usage", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "User required" }, 403);

  const limit = parseInt(c.req.query("limit") ?? "50", 10);
  const offset = parseInt(c.req.query("offset") ?? "0", 10);

  try {
    const db = createDb(c.env.DB);
    const rows = await db
      .select({
        id: usageRecords.id,
        botId: usageRecords.botId,
        type: usageRecords.type,
        amount: usageRecords.amount,
        createdAt: usageRecords.createdAt,
      })
      .from(usageRecords)
      .where(eq(usageRecords.userId, user.id))
      .orderBy(desc(usageRecords.createdAt))
      .limit(limit)
      .offset(offset);

    return c.json({ usage: rows, limit, offset });
  } catch (err) {
    console.error("[billing/usage] Get failed:", err);
    return c.json({ error: "Failed to fetch usage records" }, 500);
  }
});

export default app;
