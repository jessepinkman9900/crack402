import type { Bindings } from "../types";

/**
 * Run Better-Auth programmatic migrations.
 *
 * Note: Drizzle Kit migrations are applied via 'wrangler d1 migrations apply' command.
 * Better-Auth migrations are run programmatically for auth tables (user, session, apikey, etc.).
 * Custom tables (bots, credits, usage_records) are managed by Drizzle Kit.
 */
export async function runMigrations(env: Bindings) {
  // 1. Run Better-Auth migrations (creates user, session, account, verification, apikey tables)
  const { createAuth } = await import("./auth");
  const auth = createAuth(env);

  const { getMigrations } = await import("better-auth/db/migration");
  const { toBeCreated, toBeAdded, runMigrations: runAuthMigrations } =
    await getMigrations(auth.options);

  if (toBeCreated.length > 0 || toBeAdded.length > 0) {
    console.log(
      `[migrate] Better-Auth: creating ${toBeCreated.length} tables, adding columns to ${toBeAdded.length} tables`
    );
    await runAuthMigrations();
    console.log("[migrate] Better-Auth migrations complete");
  } else {
    console.log("[migrate] Better-Auth: schema up to date");
  }

  console.log(
    "[migrate] Drizzle migrations are applied via 'wrangler d1 migrations apply' command"
  );

  return {
    authTablesCreated: toBeCreated.length,
    authColumnsAdded: toBeAdded.length,
  };
}
