import { describe, it, expect } from "vitest";
import { getTestInstance } from "better-auth/test";

/**
 * Unit tests for better-auth flows using getTestInstance.
 * Runs in plain Node with an in-memory SQLite database.
 *
 * getTestInstance creates:
 *   - A full better-auth server with emailAndPassword + bearer plugins
 *   - A default test user: { email: "test@test.com", password: "test123456" }
 *   - A `db` adapter for direct database queries
 *   - `signInWithTestUser()` and `signInWithUser()` helpers that return headers
 *     with the session cookie already set
 */
describe("Auth Flows (better-auth/test)", () => {
  describe("signInWithTestUser", () => {
    it("returns a user and session cookie headers for the default test user", async () => {
      const { auth, signInWithTestUser } = await getTestInstance();

      const { user, headers } = await signInWithTestUser();

      expect(user.email).toBe("test@test.com");
      expect(headers).toBeInstanceOf(Headers);

      // Validate the session cookie via getSession
      const session = await auth.api.getSession({ headers });
      expect(session).not.toBeNull();
      expect(session?.user.email).toBe("test@test.com");
    });

    it("returned headers contain a session cookie", async () => {
      const { signInWithTestUser } = await getTestInstance();

      const { headers } = await signInWithTestUser();

      const cookie = headers.get("cookie");
      expect(cookie).toContain("better-auth.session_token=");
    });

    it("runWithUser runs a function authenticated as the test user", async () => {
      const { auth, signInWithTestUser } = await getTestInstance();

      const { runWithUser } = await signInWithTestUser();

      await runWithUser(async (headers) => {
        const session = await auth.api.getSession({ headers });
        expect(session?.user.email).toBe("test@test.com");
      });
    });
  });

  describe("signInWithUser", () => {
    it("signs in a custom user and returns valid session headers", async () => {
      const { auth, signInWithUser } = await getTestInstance();

      await auth.api.signUpEmail({
        body: { email: "custom@example.com", password: "Password123!", name: "Custom" },
      });

      const { res, headers } = await signInWithUser("custom@example.com", "Password123!");

      expect(res.user.email).toBe("custom@example.com");

      const session = await auth.api.getSession({ headers });
      expect(session?.user.email).toBe("custom@example.com");
    });

    it("different users have different sessions", async () => {
      const { auth, signInWithTestUser, signInWithUser } = await getTestInstance();

      await auth.api.signUpEmail({
        body: { email: "second@example.com", password: "Password123!", name: "Second" },
      });

      const { headers: headers1 } = await signInWithTestUser();
      const { headers: headers2 } = await signInWithUser("second@example.com", "Password123!");

      const session1 = await auth.api.getSession({ headers: headers1 });
      const session2 = await auth.api.getSession({ headers: headers2 });

      expect(session1?.user.email).toBe("test@test.com");
      expect(session2?.user.email).toBe("second@example.com");
      expect(session1?.session.id).not.toBe(session2?.session.id);
    });
  });

  describe("server-side API (auth.api)", () => {
    it("signUpEmail creates a user in the database", async () => {
      const { auth, db } = await getTestInstance();

      await auth.api.signUpEmail({
        body: { email: "dbcheck@example.com", password: "Password123!", name: "DB Check" },
      });

      const user = await db.findOne({
        model: "user",
        where: [{ field: "email", value: "dbcheck@example.com" }],
      });

      expect(user).not.toBeNull();
      expect((user as any).email).toBe("dbcheck@example.com");
    });

    it("getSession returns null for an invalid token", async () => {
      const { auth } = await getTestInstance();

      const headers = new Headers({ cookie: "better-auth.session_token=not-a-real-token" });
      const session = await auth.api.getSession({ headers });

      expect(session).toBeNull();
    });

    it("getSession returns null after sign-out", async () => {
      const { auth, signInWithTestUser } = await getTestInstance();

      const { headers } = await signInWithTestUser();

      const before = await auth.api.getSession({ headers });
      expect(before).not.toBeNull();

      await auth.api.signOut({ headers });

      const after = await auth.api.getSession({ headers });
      expect(after).toBeNull();
    });
  });
});
