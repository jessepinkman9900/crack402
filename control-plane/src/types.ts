import type { Context } from "hono";

/**
 * Supported cloud providers
 */
export type CloudProvider = "hetzner" | "aws";

/**
 * Cloud provider configuration structure
 */
export interface CloudConfig {
  aws: {
    defaultRegion: string;
    defaultInstanceType: string;
    defaultAmi: string;
    regions: string[];
  };
}

/**
 * Base environment bindings common to all cloud providers
 */
export interface BaseBindings {
  DB: D1Database;
  MOCK_EXTERNAL_SERVICES: string;
  DISABLE_AUTH?: string;
  FRONTEND_URL: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  BETTER_AUTH_SECRET: string;

  // Sandbox API — Durable Objects
  GLOBAL_SCHEDULER: DurableObjectNamespace;
  NODE_MANAGER: DurableObjectNamespace;
  SANDBOX_TRACKER: DurableObjectNamespace;
  TENANT_QUOTA: DurableObjectNamespace;

  // Sandbox API — R2
  SNAPSHOTS: R2Bucket;

  // Sandbox API — KV
  TENANT_KEYS: KVNamespace;
  NODE_TOKENS: KVNamespace;

  // Sandbox API — Config
  PAYMENT_RECIPIENT?: string;
  PAYMENT_NETWORK?: string;
  PAYMENT_ASSET?: string;
  OPERATOR_API_KEY?: string;

  // Seeded admins — comma-separated GitHub logins promoted to admin on every OAuth login
  ADMIN_GITHUB_USERNAMES?: string;

  // Analytics Engine datasets
  AE_SANDBOX_LIFECYCLE: AnalyticsEngineDataset;
  AE_EXEC_RESULTS: AnalyticsEngineDataset;
  AE_BILLING_USAGE: AnalyticsEngineDataset;

  // Analytics Engine query credentials
  CF_ACCOUNT_ID: string;
  CF_AE_API_TOKEN: string;
}

/**
 * Hetzner-specific environment bindings
 */
export interface HetznerBindings extends BaseBindings {
  CLOUD_PROVIDER: "hetzner";
  HETZNER_MANGEMENT_API_KEY: string;
}

/**
 * AWS-specific environment bindings
 */
export interface AWSBindings extends BaseBindings {
  CLOUD_PROVIDER: "aws";
  AWS_ACCESS_KEY_ID: string;
  AWS_SECRET_ACCESS_KEY: string;
  AWS_REGION: string;
}

/**
 * Discriminated union of all cloud provider bindings
 */
export type Bindings = HetznerBindings | AWSBindings;

export type Variables = {
  user: {
    id: string;
    name: string;
    email: string;
    image: string | null;
    role: string | null;
  } | null;
  session: {
    id: string;
    userId: string;
    token: string;
    expiresAt: Date;
  } | null;
  // Sandbox API variables
  tenantId: string | null;
  nodeId: string | null;
  requestId: string;
};

export type Env = {
  Bindings: Bindings;
  Variables: Variables;
};

export type AppContext = Context<Env>;
