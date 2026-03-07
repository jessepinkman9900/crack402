import { describe, it, expect, beforeAll } from "vitest";
import { SELF, env } from "cloudflare:test";
import { applyAuthMigrations } from "./setup";

// ---- helpers ----------------------------------------------------------------

/**
 * Sign up a new user and return the raw session token string.
 * The token can be used as:
 *   - Cookie:  `better-auth.session_token=<token>`
 *   - Bearer:  `Authorization: Bearer <token>`
 */
async function signUpAndGetToken(email: string, password = "Password123!"): Promise<string> {
  const res = await SELF.fetch("http://localhost/api/auth/sign-up/email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, name: "Test User" }),
  });
  if (!res.ok) {
    throw new Error(`Sign-up failed for ${email}: ${res.status} ${await res.text()}`);
  }
  const cookieHeader = res.headers.get("set-cookie") ?? "";
  const match = cookieHeader.match(/better-auth\.session_token=([^;]+)/);
  if (!match) throw new Error("No session token in Set-Cookie header");
  return decodeURIComponent(match[1]);
}

/**
 * Sign in an existing user and return their session token.
 */
async function signInAndGetToken(email: string, password = "Password123!"): Promise<string> {
  const res = await SELF.fetch("http://localhost/api/auth/sign-in/email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    throw new Error(`Sign-in failed for ${email}: ${res.status} ${await res.text()}`);
  }
  const cookieHeader = res.headers.get("set-cookie") ?? "";
  const match = cookieHeader.match(/better-auth\.session_token=([^;]+)/);
  if (!match) throw new Error("No session token in Set-Cookie header");
  return decodeURIComponent(match[1]);
}

/**
 * Create a better-auth API key (mship_ prefix) using an existing session token.
 */
async function createApiKey(sessionToken: string, name: string): Promise<string> {
  const res = await SELF.fetch("http://localhost/api/auth/api-key/create", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    throw new Error(`API key creation failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as any;
  return data.key as string;
}

// ---- tests ------------------------------------------------------------------

describe("Sandbox Auth Middleware", () => {
  beforeAll(async () => {
    await applyAuthMigrations();
  });

  // --- No credentials --------------------------------------------------------

  it("returns 401 with no credentials", async () => {
    const res = await SELF.fetch("http://localhost/v1/sandboxes");
    expect(res.status).toBe(401);
    const body = (await res.json()) as any;
    expect(body.error).toBe("unauthorized");
  });

  // --- Session token (email sign-up → Bearer) --------------------------------

  describe("session token (Bearer)", () => {
    let token: string;

    beforeAll(async () => {
      token = await signUpAndGetToken("bearer-user@example.com");
    });

    it("accepts a valid session Bearer token", async () => {
      const res = await SELF.fetch("http://localhost/v1/sandboxes", {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
    });

    it("auto-provisions a tenant on first use", async () => {
      const res = await SELF.fetch("http://localhost/v1/sandboxes", {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
      // Tenant should now exist in DB
      const row = await (env as any).DB.prepare(
        "SELECT id FROM tenants WHERE status = 'active' LIMIT 1"
      ).first<{ id: string }>();
      expect(row?.id).toMatch(/^ten_/);
    });

    it("returns same tenant for repeated requests", async () => {
      const getTenantId = async () => {
        // Create sandboxes returns the sandbox with context; just check 200 and DB directly
        await SELF.fetch("http://localhost/v1/sandboxes", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const row = await (env as any).DB.prepare(
          `SELECT id FROM tenants WHERE status = 'active'
           ORDER BY created_at ASC LIMIT 1`
        ).first<{ id: string }>();
        return row?.id;
      };

      const id1 = await getTenantId();
      const id2 = await getTenantId();
      expect(id1).toBe(id2);
    });

    it("rejects an invalid Bearer token", async () => {
      const res = await SELF.fetch("http://localhost/v1/sandboxes", {
        headers: { Authorization: "Bearer this-is-not-a-valid-token" },
      });
      expect(res.status).toBe(401);
    });
  });

  // --- Session cookie ---------------------------------------------------------

  describe("session cookie", () => {
    it("accepts a valid session cookie", async () => {
      // Sign up returns Set-Cookie; forward the raw cookie value
      const signUpRes = await SELF.fetch("http://localhost/api/auth/sign-up/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "cookie-user@example.com",
          password: "Password123!",
          name: "Cookie User",
        }),
      });
      expect(signUpRes.ok).toBe(true);
      const setCookie = signUpRes.headers.get("set-cookie") ?? "";

      // Strip the metadata (Expires, Path, etc.) and keep just name=value pairs
      const cookiePairs = setCookie
        .split(",")
        .map((part) => part.trim().split(";")[0])
        .join("; ");

      const res = await SELF.fetch("http://localhost/v1/sandboxes", {
        headers: { Cookie: cookiePairs },
      });
      expect(res.status).toBe(200);
    });
  });

  // --- better-auth API key (mship_ prefix) -----------------------------------

  describe("better-auth API key (mship_)", () => {
    let apiKey: string;

    beforeAll(async () => {
      const token = await signUpAndGetToken("apikey-user@example.com");
      apiKey = await createApiKey(token, "test-key");
    });

    it("API key has mship_ prefix", () => {
      expect(apiKey).toMatch(/^mship_/);
    });

    it("accepts mship_ API key via X-API-Key header", async () => {
      const res = await SELF.fetch("http://localhost/v1/sandboxes", {
        headers: { "X-API-Key": apiKey },
      });
      expect(res.status).toBe(200);
    });

    it("accepts mship_ API key via Authorization Bearer", async () => {
      const res = await SELF.fetch("http://localhost/v1/sandboxes", {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      expect(res.status).toBe(200);
    });

    it("rejects an invalid mship_ API key", async () => {
      const res = await SELF.fetch("http://localhost/v1/sandboxes", {
        headers: { "X-API-Key": "mship_definitely_not_valid" },
      });
      expect(res.status).toBe(401);
    });
  });

  // --- KV tenant key ---------------------------------------------------------

  describe("KV tenant key", () => {
    const kvKey = "test-tenant-kv-key-abc123";
    const kvTenantId = "ten_test_kv_tenant_000000";

    beforeAll(async () => {
      await (env as any).TENANT_KEYS.put(kvKey, kvTenantId);
    });

    it("accepts a KV tenant key via X-API-Key", async () => {
      const res = await SELF.fetch("http://localhost/v1/sandboxes", {
        headers: { "X-API-Key": kvKey },
      });
      expect(res.status).toBe(200);
    });

    it("accepts a KV tenant key via Bearer", async () => {
      const res = await SELF.fetch("http://localhost/v1/sandboxes", {
        headers: { Authorization: `Bearer ${kvKey}` },
      });
      expect(res.status).toBe(200);
    });

    it("rejects an unknown KV key (no session fallback)", async () => {
      const res = await SELF.fetch("http://localhost/v1/sandboxes", {
        headers: { "X-API-Key": "completely-unknown-key-xyz" },
      });
      // Falls through to session check, no valid session → 401
      expect(res.status).toBe(401);
    });
  });

  // --- Sign-in (existing user) -----------------------------------------------

  describe("sign-in flow", () => {
    it("session from sign-in works the same as sign-up", async () => {
      const email = "signin-user@example.com";
      await signUpAndGetToken(email); // create account
      const token = await signInAndGetToken(email); // fresh sign-in

      const res = await SELF.fetch("http://localhost/v1/sandboxes", {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
    });
  });
});
