import { Hono } from "hono";
import type { Env } from "../types";

/**
 * User routes
 *
 * GET /v1/users/me — Return the current authenticated user
 */
const users = new Hono<Env>();

users.get("/me", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "User required" }, 403);

  // Fetch fresh user data including any fields we might have skipped
  try {
    const row = await c.env.DB.prepare(
      "SELECT id, name, email, image, createdAt, updatedAt FROM user WHERE id = ?"
    )
      .bind(user.id)
      .first();

    if (!row) {
      return c.json({ error: "User not found" }, 404);
    }

    return c.json({ user: row });
  } catch (err) {
    console.error("[users/me] Failed:", err);
    return c.json({ error: "Failed to fetch user" }, 500);
  }
});

export default users;
