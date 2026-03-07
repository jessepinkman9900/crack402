import type { Bindings } from "../types";
import type { Auth } from "./auth";

/**
 * Verify a mship_ API key and return the userId + role.
 * Returns null if the key is invalid.
 */
export async function getUserRoleFromApiKey(
  env: Bindings,
  auth: Auth,
  token: string
): Promise<{ userId: string; role: string } | null> {
  const result = await auth.api
    .verifyApiKey({ body: { key: token } })
    .catch(() => null);

  const key = result?.key as any;
  if (!result?.valid || !key?.userId) return null;

  const userId = key.userId as string;
  const row = await env.DB.prepare("SELECT role FROM user WHERE id = ?")
    .bind(userId)
    .first<{ role: string | null }>();

  return { userId, role: row?.role ?? "user" };
}

/**
 * Verify a session (cookie or Bearer session token) and return the userId + role.
 * Returns null if no valid session exists.
 */
export async function getUserRoleFromSession(
  env: Bindings,
  auth: Auth,
  headers: Headers
): Promise<{ userId: string; role: string } | null> {
  const session = await auth.api.getSession({ headers }).catch(() => null);
  if (!session?.user?.id) return null;

  const userId = session.user.id;
  // better-auth admin plugin exposes role on session.user
  const role =
    (session.user as any).role ??
    (await env.DB.prepare("SELECT role FROM user WHERE id = ?")
      .bind(userId)
      .first<{ role: string | null }>()
      .then((r) => r?.role ?? "user"));

  return { userId, role };
}
