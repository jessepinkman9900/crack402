const API_BASE = process.env.NEXT_PUBLIC_MSHIP_API_URL ?? "http://localhost:8787";

interface SessionUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

interface Session {
  user: SessionUser;
  session: {
    id: string;
    userId: string;
    token: string;
    expiresAt: string;
  };
}

/**
 * Server-side session validation.
 *
 * Calls the Mothership API's Better-Auth getSession endpoint,
 * forwarding the request's cookies for authentication.
 */
async function getSession(opts: {
  headers: Headers;
}): Promise<Session | null> {
  const cookie = opts.headers.get("cookie");
  if (!cookie) return null;

  try {
    const res = await fetch(`${API_BASE}/api/auth/get-session`, {
      method: "GET",
      headers: {
        Cookie: cookie,
      },
    });

    if (!res.ok) return null;

    const data = await res.json();
    if (!data?.user) return null;

    return data as Session;
  } catch {
    return null;
  }
}

/**
 * Auth helper — mimics the Better-Auth API surface used by the frontend.
 * This is a thin wrapper that calls the Mothership API.
 */
export const auth = {
  api: {
    getSession,
  },
};
