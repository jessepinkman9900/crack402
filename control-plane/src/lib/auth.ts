import { betterAuth } from "better-auth";
import { apiKey } from "@better-auth/api-key";
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
      },
    },
    plugins: [
      apiKey({
        defaultPrefix: "mship_",
        rateLimit: {
          enabled: true,
          maxRequests: 100,
          timeWindow: 60_000, // 100 requests per minute
        },
        enableSessionForAPIKeys: true,
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
