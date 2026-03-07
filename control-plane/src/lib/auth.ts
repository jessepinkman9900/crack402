import { betterAuth } from "better-auth";
import { admin, organization, siwe } from "better-auth/plugins";
import { apiKey } from "@better-auth/api-key";
import { recoverMessageAddress } from "viem";
import type { Bindings } from "../types";

/**
 * Creates a Better-Auth instance bound to the request's D1 database.
 * Must be called per-request since D1 binding comes from the Worker env.
 *
 * Better-Auth natively supports D1Database as the database option —
 * it uses its built-in Kysely adapter with SQLite dialect under the hood.
 */
export function createAuth(env: Bindings) {
  return betterAuth({
    database: env.DB as any,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.FRONTEND_URL,
    basePath: "/api/auth",
    socialProviders: {
      github: {
        clientId: env.GITHUB_CLIENT_ID,
        clientSecret: env.GITHUB_CLIENT_SECRET,
        mapProfileToUser: async (profile: any) => {
          const adminLogins = env.ADMIN_GITHUB_USERNAMES
            ?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
          if (adminLogins.length > 0 && adminLogins.includes(profile.login)) {
            return { role: "admin" };
          }
          return {};
        },
      },
    },
    plugins: [
      admin({ defaultRole: "user" }),
      organization(),
      apiKey({
        defaultPrefix: "mship_",
        rateLimit: {
          enabled: true,
          maxRequests: 100,
          timeWindow: 60_000, // 100 requests per minute
        },
        enableSessionForAPIKeys: true,
      }),
      siwe({
        domain: new URL(env.FRONTEND_URL).hostname,
        getNonce: async () => {
          const bytes = new Uint8Array(32);
          crypto.getRandomValues(bytes);
          return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
        },
        verifyMessage: async ({ message, signature, address }) => {
          try {
            const recovered = await recoverMessageAddress({
              message,
              signature: signature as `0x${string}`,
            });
            return recovered.toLowerCase() === address.toLowerCase();
          } catch {
            return false;
          }
        },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
