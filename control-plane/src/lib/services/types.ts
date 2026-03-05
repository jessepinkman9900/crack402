/**
 * Service adapter interfaces for external services.
 * Each has a real implementation (calls actual APIs) and a mock implementation.
 */

// --- Cloud Provider (Generic) ---

/**
 * Generic cloud server instance representation.
 * Works across all cloud providers (Hetzner, AWS, etc.)
 */
export interface CloudServer {
  id: string;
  name: string;
  status: "initializing" | "running" | "stopping" | "off" | "deleting";
  publicIp: string | null;
  region: string;
  serverType: string;
  provider: string; // e.g., "hetzner", "aws"
}

/**
 * Server creation options that work across all cloud providers
 */
export interface ServerCreationOptions {
  name: string;
  region: string;
  serverType?: string;
  image?: string;
  cloudInit?: string;
}

/**
 * Region pricing information
 */
export interface RegionPricing {
  region: string;
  priceHourly: number;
}

/**
 * Server type information and capabilities
 */
export interface ServerTypeInfo {
  name: string;
  vcpus: number;
  memory: number; // GB
  storage: number; // GB
  priceHourly: number;
  availability: string[]; // regions where available
}

/**
 * Generic cloud provider adapter interface.
 * Implement this for each cloud provider (Hetzner, AWS, etc.)
 */
export interface CloudProviderAdapter {
  createServer(opts: ServerCreationOptions): Promise<CloudServer>;
  deleteServer(serverId: string): Promise<void>;
  getServer(serverId: string): Promise<CloudServer | null>;
  /**
   * Returns the location with the lowest hourly price for the given server type.
   * Falls back to a default region when the API is unavailable or server type not found.
   */
  getCheapestRegion(serverType: string): Promise<RegionPricing>;
  /**
   * List available server types for this provider
   */
  listAvailableServerTypes(): Promise<ServerTypeInfo[]>;
  /**
   * Get the provider name (e.g., "hetzner", "aws")
   */
  getProviderName(): string;
}

// --- Legacy Hetzner Types (for backward compatibility) ---

export interface HetznerServer {
  id: string;
  name: string;
  status: "initializing" | "running" | "stopping" | "off" | "deleting";
  publicIp: string | null;
  region: string;
  serverType: string;
}

export interface HetznerAdapter {
  createServer(opts: {
    name: string;
    region: string;
    serverType?: string;
    image?: string;
    cloudInit?: string;
  }): Promise<HetznerServer>;
  deleteServer(serverId: string): Promise<void>;
  getServer(serverId: string): Promise<HetznerServer | null>;
  /**
   * Returns the location with the lowest hourly price for the given server
   * type, as reported by the Hetzner API.
   * - `region`: Hetzner location name (e.g. "nbg1")
   * - `priceHourly`: net hourly price in USD as a float (e.g. 0.00403361)
   * Falls back to `{ region: "nbg1", priceHourly: 0 }` when the API is
   * unavailable or the server type is not found.
   */
  getCheapestRegion(serverType: string): Promise<{ region: string; priceHourly: number }>;
}

// --- OpenRouter ---

export interface OpenRouterKey {
  id: string;
  key: string;
  name: string;
  limit?: number;
}

export interface OpenRouterAdapter {
  provisionKey(opts: {
    name: string;
    label?: string;
    monthlyLimit?: number;
  }): Promise<OpenRouterKey>;
  revokeKey(keyId: string): Promise<void>;
}

// --- Polar (billing) ---

export interface PolarSubscription {
  id: string;
  status: "active" | "canceled" | "past_due" | "trialing";
  plan: string;
  currentPeriodEnd: string;
}

export interface PolarCheckout {
  url: string;
  id: string;
}

export interface PolarAdapter {
  getSubscription(userId: string): Promise<PolarSubscription | null>;
  createCheckoutUrl(opts: {
    userId: string;
    plan: string;
    successUrl: string;
  }): Promise<PolarCheckout>;
}

// --- Combined services ---

export interface Services {
  cloudProvider: CloudProviderAdapter; // Generic cloud provider (Hetzner, AWS, etc.)
  hetzner?: HetznerAdapter; // Legacy - for backward compatibility
  openrouter: OpenRouterAdapter;
  polar: PolarAdapter;
}
