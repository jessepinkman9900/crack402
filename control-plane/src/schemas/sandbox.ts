import { z } from "zod/v4";
import { MetadataSchema } from "./common";

export const SandboxStatusSchema = z.enum([
  "provisioning",
  "ready",
  "running",
  "paused",
  "stopping",
  "stopped",
  "error",
  "destroyed",
]).openapi("SandboxStatus");

export type SandboxStatus = z.infer<typeof SandboxStatusSchema>;

export const NetworkPolicySchema = z.enum(["none", "outbound-only", "full"]).openapi("NetworkPolicy");

export const GpuTypeSchema = z.enum([
  "T4", "L4", "A10G", "L40S", "A100-40", "A100-80", "H100", "H200", "B200",
]).openapi("GpuType");

export const IsolationBackendSchema = z.enum([
  "firecracker", "gvisor", "kata", "wasm", "container", "v8-isolate",
]).openapi("IsolationBackend");

export const LanguageSchema = z.enum([
  "python", "javascript", "typescript", "ruby", "go", "rust", "java", "bash",
]).openapi("Language");

export const GithubRepoSchema = z.object({
  url: z.url().openapi({ description: "GitHub repository URL", example: "https://github.com/org/repo" }),
  branch: z.string().default("main").openapi({ description: "Branch to clone", example: "main" }),
  commit: z.string().optional().openapi({ description: "Specific commit SHA to checkout", example: "a1b2c3d4" }),
  path: z.string().default("/workspace").openapi({ description: "Path to clone into", example: "/workspace" }),
  token: z.string().optional().openapi({ description: "GitHub access token for private repos" }),
}).openapi("GithubRepo");

export const PaymentInfoSchema = z.object({
  method: z.enum(["x402", "api_key_billing", "prepaid_credits"]).openapi({ description: "Payment method", example: "api_key_billing" }),
  x402_signature: z.string().optional().openapi({ description: "x402 payment signature" }),
  budget_limit_usd: z.number().optional().openapi({ description: "Maximum budget in USD", example: 10.0 }),
}).openapi("PaymentInfo");

export const CreateSandboxRequestSchema = z.object({
  base_image: z.string().openapi({ description: "Base container image", example: "ubuntu:22.04" }),
  vcpu: z.number().min(0.25).max(32).default(2).openapi({ description: "Number of virtual CPUs", example: 2 }),
  memory_mb: z.number().int().min(256).max(131072).default(2048).openapi({ description: "Memory allocation in MB", example: 2048 }),
  gpu: GpuTypeSchema.nullable().optional().openapi({ description: "GPU type, null for no GPU" }),
  timeout_seconds: z.number().int().min(10).max(86400).default(3600).openapi({ description: "Max sandbox lifetime in seconds", example: 3600 }),
  idle_timeout_seconds: z.number().int().min(0).max(86400).default(600).openapi({ description: "Idle timeout before auto-pause/destroy in seconds", example: 600 }),
  auto_destroy: z.boolean().default(true).openapi({ description: "Destroy sandbox when timeout expires", example: true }),
  auto_pause_on_idle: z.boolean().default(false).openapi({ description: "Pause sandbox when idle instead of destroying", example: false }),
  code: z.string().nullable().optional().openapi({ description: "Inline code to execute on start" }),
  language: LanguageSchema.nullable().optional().openapi({ description: "Language for inline code execution" }),
  github_repo: GithubRepoSchema.nullable().optional().openapi({ description: "GitHub repo to clone into the sandbox" }),
  env_vars: z.record(z.string(), z.string()).optional().openapi({ description: "Environment variables to set", example: { NODE_ENV: "production" } }),
  network_policy: NetworkPolicySchema.default("outbound-only").openapi({ description: "Network access policy", example: "outbound-only" }),
  exposed_ports: z.array(z.number().int()).optional().openapi({ description: "Ports to expose publicly", example: [3000, 8080] }),
  volumes: z.array(z.object({
    name: z.string().openapi({ description: "Volume name", example: "data" }),
    mount_path: z.string().openapi({ description: "Mount path inside sandbox", example: "/data" }),
    size_gb: z.number().openapi({ description: "Volume size in GB", example: 10 }),
  })).optional().openapi({ description: "Persistent volumes to attach" }),
  metadata: MetadataSchema.optional().openapi({ description: "Arbitrary key-value metadata" }),
  payment: PaymentInfoSchema.nullable().optional().openapi({ description: "Payment information" }),
}).openapi("CreateSandboxRequest");

export type CreateSandboxRequest = z.infer<typeof CreateSandboxRequestSchema>;

export const SandboxEventSchema = z.object({
  type: z.string().openapi({ description: "Event type", example: "state_change" }),
  status: z.string().openapi({ description: "Sandbox status at event time", example: "running" }),
  timestamp: z.string().datetime().openapi({ description: "ISO 8601 event timestamp", example: "2026-01-15T12:00:00Z" }),
}).openapi("SandboxEvent");

export const SandboxSchema = z.object({
  sandbox_id: z.string().openapi({ description: "Unique sandbox identifier", example: "sbx_abc12345678901234567" }),
  status: SandboxStatusSchema.openapi({ description: "Current sandbox status" }),
  base_image: z.string().openapi({ description: "Base container image", example: "ubuntu:22.04" }),
  vcpu: z.number().openapi({ description: "Allocated virtual CPUs", example: 2 }),
  memory_mb: z.number().int().openapi({ description: "Allocated memory in MB", example: 2048 }),
  gpu: z.string().nullable().openapi({ description: "GPU type or null" }),
  timeout_seconds: z.number().int().openapi({ description: "Max sandbox lifetime in seconds", example: 3600 }),
  idle_timeout_seconds: z.number().int().openapi({ description: "Idle timeout in seconds", example: 600 }),
  network_policy: z.string().openapi({ description: "Network access policy", example: "outbound-only" }),
  env_vars: z.record(z.string(), z.string()).optional().openapi({ description: "Environment variables" }),
  metadata: MetadataSchema.optional().openapi({ description: "Arbitrary key-value metadata" }),
  created_at: z.string().datetime().openapi({ description: "ISO 8601 creation timestamp", example: "2026-01-15T12:00:00Z" }),
  started_at: z.string().datetime().nullable().openapi({ description: "ISO 8601 start timestamp, null if not started" }),
  expires_at: z.string().datetime().optional().openapi({ description: "ISO 8601 expiration timestamp" }),
  public_url: z.string().nullable().optional().openapi({ description: "Public URL for the sandbox", example: "https://sbx-abc123.sandbox.example.com" }),
  private_ip: z.string().nullable().optional().openapi({ description: "Private IP address", example: "10.0.1.5" }),
  region: z.string().optional().openapi({ description: "Deployment region", example: "us-east-1" }),
  isolation_backend: IsolationBackendSchema.optional().openapi({ description: "Isolation technology used" }),
  cost_accrued_usd: z.number().optional().openapi({ description: "Total cost accrued in USD", example: 0.42 }),
  events: z.array(SandboxEventSchema).optional().openapi({ description: "Recent sandbox events" }),
}).openapi("Sandbox");

export type Sandbox = z.infer<typeof SandboxSchema>;

export const StopRequestSchema = z.object({
  signal: z.enum(["SIGTERM", "SIGKILL"]).default("SIGTERM").openapi({ description: "Signal to send to the sandbox process", example: "SIGTERM" }),
  grace_period_seconds: z.number().int().default(10).openapi({ description: "Grace period before force-killing in seconds", example: 10 }),
}).openapi("StopRequest");
