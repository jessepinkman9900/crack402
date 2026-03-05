/**
 * Mothership API client — used by both server components (SSR) and client components.
 *
 * In SSR (server components), cookies are forwarded from the incoming request.
 * In client components, the browser sends cookies automatically via credentials: "include".
 */

const API_BASE = process.env.NEXT_PUBLIC_MSHIP_API_URL ?? "http://localhost:8787";

type RequestOptions = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
};

class ApiError extends Error {
  constructor(
    public status: number,
    public data: { error: string; [key: string]: unknown }
  ) {
    super(data.error);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    method: opts.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...opts.headers,
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: "include", // Send cookies for session auth
  });

  // 204 No Content
  if (res.status === 204) {
    return undefined as T;
  }

  const data = await res.json();

  if (!res.ok) {
    throw new ApiError(res.status, data);
  }

  return data as T;
}

/**
 * Server-side request helper — forwards cookies from the incoming request.
 * Use in Server Components and Server Actions.
 */
async function serverRequest<T>(
  path: string,
  cookie: string,
  opts: RequestOptions = {}
): Promise<T> {
  return request<T>(path, {
    ...opts,
    headers: {
      ...opts.headers,
      Cookie: cookie,
    },
  });
}

// --- Type definitions ---

export interface Bot {
  id: string;
  name: string;
  status: "stopped" | "provisioning" | "running" | "deleting" | "deleted";
  provisioningStatus: "pending_openrouter" | "pending_vm" | "pending_setup" | "ready" | "failed" | null;
  provider: string;
  botType?: "standard" | "gateway";
  region: string;
  serverId: string | null;
  ipAddress: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Region {
  id: string;
  name: string;
  provider: string;
  flag: string;
}

export interface ApiToken {
  id: string;
  name: string;
  key?: string; // Only present on creation
  start: string;
  expiresAt: string | null;
  createdAt: string;
  enabled: boolean;
}

export interface SSHKey {
  id: string;
  name: string;
  publicKey: string;
  privateKey?: string; // Only present on creation
  fingerprint: string;
  filename?: string; // Only present on creation
  createdAt: number;
}

// --- API functions (client-side) ---

export const api = {
  // Bots
  listBots: () => request<{ bots: Bot[] }>("/v1/bots"),
  getBot: (id: string) => request<Bot>(`/v1/bots/${id}`),
  createBot: (data: { name: string; provider: string; botType?: "standard" | "gateway" }) =>
    request<Bot>("/v1/bots", { method: "POST", body: data }),
  deleteBot: (id: string) =>
    request<void>(`/v1/bots/${id}`, { method: "DELETE" }),
  provisionBot: (
    id: string,
    data: {
      // Bot type-specific fields
      channelType?: string;
      channelToken?: string;
      gatewayHost?: string;
      gatewayPort?: number;
      gatewayNewPairing?: boolean;
      // Common fields
      monthlyLimit?: number;
      sshKeyId?: string;
    }
  ) =>
    request<{ id: string; name: string; provisioningStatus: string; message: string }>(
      `/v1/bots/${id}/provision`,
      { method: "POST", body: data }
    ),
  stopBot: (id: string) =>
    request<Bot>(`/v1/bots/${id}/stop`, { method: "POST" }),

  // Cloud
  getRegions: (provider: string) =>
    request<{ provider: string; regions: Region[] }>(
      `/v1/cloud/regions?provider=${provider}`
    ),

  // Auth / Tokens
  listTokens: () => request<{ tokens: ApiToken[] }>("/v1/auth/tokens"),
  createToken: (data: { name?: string; expiresIn?: number }) =>
    request<ApiToken>("/v1/auth/tokens", { method: "POST", body: data }),
  revokeToken: (id: string) =>
    request<{ success: boolean }>(`/v1/auth/tokens/${id}`, {
      method: "DELETE",
    }),

  // Users
  getMe: () => request<{ user: Record<string, unknown> }>("/v1/users/me"),

  // Billing
  getCredits: () => request<{ balance: number }>("/v1/billing/credits"),
  getUsage: (opts?: { limit?: number; offset?: number }) => {
    const params = new URLSearchParams();
    if (opts?.limit) params.set("limit", String(opts.limit));
    if (opts?.offset) params.set("offset", String(opts.offset));
    const qs = params.toString();
    return request<{
      usage: Array<{
        id: string;
        botId: string;
        type: string;
        amount: number;
        createdAt: string;
      }>;
    }>(`/v1/billing/usage${qs ? `?${qs}` : ""}`);
  },

  // SSH Keys
  listSSHKeys: () => request<{ keys: SSHKey[] }>("/v1/ssh-keys"),
  createSSHKey: (data: { name: string }) =>
    request<SSHKey>("/v1/ssh-keys", { method: "POST", body: data }),
  deleteSSHKey: (id: string) =>
    request<{ success: boolean }>(`/v1/ssh-keys/${id}`, { method: "DELETE" }),
};

// --- Server-side API functions ---

export const serverApi = {
  listBots: (cookie: string) =>
    serverRequest<{ bots: Bot[] }>("/v1/bots", cookie),
  getBot: (id: string, cookie: string) =>
    serverRequest<Bot>(`/v1/bots/${id}`, cookie),
  getMe: (cookie: string) =>
    serverRequest<{ user: Record<string, unknown> }>("/v1/users/me", cookie),
};
