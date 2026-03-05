import type { Context } from "hono";

/**
 * Supported cloud providers
 */
export type CloudProvider = 'hetzner' | 'aws';

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
  BOT_PROVISIONING_WORKFLOW: Workflow;
  MOCK_EXTERNAL_SERVICES: string;
  DISABLE_AUTH?: string;
  FRONTEND_URL: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  BETTER_AUTH_SECRET: string;
  WORKFLOW_SECRET: string;
  OPENROUTER_MANGEMENT_API_KEY: string;
  OPENROUTER_WEBHOOK_SECRET: string;
  CLOUD_PROVIDER: CloudProvider;
  CLOUD_CONFIG: string; // JSON string of CloudConfig
  SERVER_TYPE?: string; // Optional, defaults to provider-specific default
}

/**
 * Hetzner-specific environment bindings
 */
export interface HetznerBindings extends BaseBindings {
  CLOUD_PROVIDER: 'hetzner';
  HETZNER_MANGEMENT_API_KEY: string;
}

/**
 * AWS-specific environment bindings
 */
export interface AWSBindings extends BaseBindings {
  CLOUD_PROVIDER: 'aws';
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
  } | null;
  session: {
    id: string;
    userId: string;
    token: string;
    expiresAt: Date;
  } | null;
};

export type Env = {
  Bindings: Bindings;
  Variables: Variables;
};

export type AppContext = Context<Env>;
