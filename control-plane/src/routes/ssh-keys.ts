import { Hono } from "hono";
import type { Env } from "../types";
import { createDb, sshKeys } from "../db";
import { eq, and, desc } from "drizzle-orm";
import { generateSSHKeyPair, generatePrivateKeyFilename, formatPrivateKeyForDownload } from "../lib/services/ssh-keys";
import { nanoid } from "nanoid";

/**
 * SSH Key routes
 *
 * POST   /v1/ssh-keys       — Generate a new SSH key pair
 * GET    /v1/ssh-keys       — List SSH keys for the current user
 * DELETE /v1/ssh-keys/:id   — Delete an SSH key
 */
const app = new Hono<Env>();

// --- Generate SSH key pair ---
app.post("/", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "User required" }, 403);

  const body = await c.req.json<{
    name?: string;
  }>();

  if (!body.name?.trim()) {
    return c.json({ error: "Missing required field: name" }, 400);
  }

  const keyName = body.name.trim();

  // Validate name length and characters
  if (keyName.length > 100) {
    return c.json({ error: "Key name must be 100 characters or less" }, 400);
  }

  try {
    // Generate SSH key pair
    const keyPair = generateSSHKeyPair(keyName);

    const db = createDb(c.env.DB);
    const now = Date.now();
    const keyId = nanoid();

    // Store public key in database
    await db.insert(sshKeys).values({
      id: keyId,
      userId: user.id,
      name: keyName,
      publicKey: keyPair.publicKey,
      fingerprint: keyPair.fingerprint,
      createdAt: now,
    });

    console.log(`[ssh-keys] Generated key ${keyId} for user ${user.id}`);

    // Return both public and private key (private key shown ONLY ONCE)
    return c.json({
      id: keyId,
      name: keyName,
      publicKey: keyPair.publicKey,
      privateKey: keyPair.privateKey, // ⚠️ ONLY returned here, never stored
      fingerprint: keyPair.fingerprint,
      filename: generatePrivateKeyFilename(keyName),
      createdAt: now,
    });
  } catch (err) {
    console.error("[ssh-keys] Failed to generate key:", err);
    return c.json({ error: "Failed to generate SSH key" }, 500);
  }
});

// --- List SSH keys ---
app.get("/", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "User required" }, 403);

  try {
    const db = createDb(c.env.DB);
    const userKeys = await db
      .select({
        id: sshKeys.id,
        name: sshKeys.name,
        publicKey: sshKeys.publicKey,
        fingerprint: sshKeys.fingerprint,
        createdAt: sshKeys.createdAt,
      })
      .from(sshKeys)
      .where(eq(sshKeys.userId, user.id))
      .orderBy(desc(sshKeys.createdAt));

    return c.json({ keys: userKeys });
  } catch (err) {
    console.error("[ssh-keys] Failed to list keys:", err);
    return c.json({ error: "Failed to list SSH keys" }, 500);
  }
});

// --- Get single SSH key ---
app.get("/:id", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "User required" }, 403);

  const keyId = c.req.param("id");

  try {
    const db = createDb(c.env.DB);
    const key = await db.query.sshKeys.findFirst({
      where: and(
        eq(sshKeys.id, keyId),
        eq(sshKeys.userId, user.id)
      ),
    });

    if (!key) {
      return c.json({ error: "SSH key not found" }, 404);
    }

    return c.json({
      id: key.id,
      name: key.name,
      publicKey: key.publicKey,
      fingerprint: key.fingerprint,
      createdAt: key.createdAt,
    });
  } catch (err) {
    console.error("[ssh-keys] Failed to get key:", err);
    return c.json({ error: "Failed to get SSH key" }, 500);
  }
});

// --- Delete SSH key ---
app.delete("/:id", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "User required" }, 403);

  const keyId = c.req.param("id");

  try {
    const db = createDb(c.env.DB);

    // Check if key exists and belongs to user
    const key = await db.query.sshKeys.findFirst({
      where: and(
        eq(sshKeys.id, keyId),
        eq(sshKeys.userId, user.id)
      ),
    });

    if (!key) {
      return c.json({ error: "SSH key not found" }, 404);
    }

    // Delete the key
    await db.delete(sshKeys).where(eq(sshKeys.id, keyId));

    console.log(`[ssh-keys] Deleted key ${keyId} for user ${user.id}`);

    return c.json({ success: true });
  } catch (err) {
    console.error("[ssh-keys] Failed to delete key:", err);
    return c.json({ error: "Failed to delete SSH key" }, 500);
  }
});

export default app;
