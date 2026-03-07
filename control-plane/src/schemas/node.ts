import "./_setup";
import { z } from "zod/v4";

export const NodeStatusSchema = z.enum([
  "pending", "healthy", "degraded", "draining", "cordoned", "offline",
]).openapi("NodeStatus");

export type NodeStatus = z.infer<typeof NodeStatusSchema>;

export const HeartbeatSchema = z.object({
  timestamp: z.string().datetime().openapi({ description: "ISO 8601 heartbeat timestamp", example: "2026-01-15T12:00:00Z" }),
  status: NodeStatusSchema.openapi({ description: "Current node health status" }),
}).openapi("Heartbeat");

export type Heartbeat = z.infer<typeof HeartbeatSchema>;

export const CommandTypeSchema = z.enum([
  "create_sandbox",
  "destroy_sandbox",
  "pause_sandbox",
  "resume_sandbox",
  "snapshot_sandbox",
  "restore_snapshot",
  "exec",
  "update_tunnel",
  "drain",
]).openapi("CommandType");

export const CommandSchema = z.object({
  command_id: z.string().openapi({ description: "Unique command identifier", example: "cmd_abc12345678901234567" }),
  type: CommandTypeSchema.openapi({ description: "Command type to execute" }),
  sandbox_id: z.string().optional().openapi({ description: "Target sandbox ID, if applicable" }),
  payload: z.record(z.string(), z.unknown()).openapi({ description: "Command-specific payload data" }),
  created_at: z.string().datetime().openapi({ description: "ISO 8601 creation timestamp", example: "2026-01-15T12:00:00Z" }),
}).openapi("Command");

export type Command = z.infer<typeof CommandSchema>;

export const CommandResultSchema = z.object({
  command_id: z.string().openapi({ description: "Command identifier", example: "cmd_abc12345678901234567" }),
  status: z.enum(["success", "failure"]).openapi({ description: "Command execution result", example: "success" }),
  error: z.string().optional().openapi({ description: "Error message if status is failure" }),
  payload: z.record(z.string(), z.unknown()).optional().openapi({ description: "Result payload data" }),
}).openapi("CommandResult");

export const SandboxStateEventSchema = z.object({
  sandbox_id: z.string().openapi({ description: "Sandbox identifier", example: "sbx_abc12345678901234567" }),
  status: z.string().openapi({ description: "New sandbox status", example: "running" }),
  timestamp: z.string().datetime().openapi({ description: "ISO 8601 event timestamp", example: "2026-01-15T12:00:00Z" }),
  error: z.string().optional().openapi({ description: "Error message if status is error" }),
}).openapi("SandboxStateEvent");

export const ExecEventSchema = z.object({
  exec_id: z.string().openapi({ description: "Execution identifier", example: "exec_abc12345678901234567" }),
  sandbox_id: z.string().openapi({ description: "Sandbox identifier", example: "sbx_abc12345678901234567" }),
  status: z.enum(["running", "completed", "failed", "timed_out"]).openapi({ description: "Execution status", example: "completed" }),
  exit_code: z.number().int().nullable().optional().openapi({ description: "Process exit code", example: 0 }),
  stdout: z.string().optional().openapi({ description: "Standard output" }),
  stderr: z.string().optional().openapi({ description: "Standard error" }),
  duration_ms: z.number().int().optional().openapi({ description: "Execution duration in milliseconds", example: 1523 }),
}).openapi("ExecEvent");

export const RegisterNodeSchema = z.object({
  region: z.string().openapi({ description: "Node deployment region", example: "us-east-1" }),
  total_vcpu: z.number().openapi({ description: "Total vCPUs available", example: 64 }),
  total_memory_mb: z.number().int().openapi({ description: "Total memory in MB", example: 262144 }),
  firecracker_version: z.string().optional().openapi({ description: "Firecracker version", example: "1.7.0" }),
  metadata: z.record(z.string(), z.string()).optional().openapi({ description: "Node metadata" }),
}).openapi("RegisterNodeRequest");

export type RegisterNodeRequest = z.infer<typeof RegisterNodeSchema>;

export const IssueRegistrationTokenResponseSchema = z.object({
  node_id: z.string().openapi({ description: "Node identifier", example: "node_abc12345678901234567" }),
  registration_token: z.string().openapi({ description: "Short-lived token for node self-registration (10min TTL)", example: "sk_abc12345678901234567" }),
  expires_at: z.string().datetime().openapi({ description: "ISO 8601 expiry timestamp", example: "2026-01-15T12:10:00Z" }),
}).openapi("IssueRegistrationTokenResponse");

export const NodeSelfRegisterSchema = z.object({
  registration_token: z.string().openapi({ description: "Registration token issued by POST /v1/mgmt/nodes/registration-token", example: "sk_hMMQGFzJBRwotokqg_B9" }),
  vcpu: z.number().openapi({ description: "Total vCPUs available", example: 64 }),
  memory_mb: z.number().int().openapi({ description: "Total memory in MB", example: 262144 }),
  region: z.string().openapi({ description: "Node deployment region", example: "us-east-1" }),
  firecracker_version: z.string().optional().openapi({ description: "Firecracker version", example: "1.7.0" }),
  metadata: z.record(z.string(), z.string()).optional().openapi({ description: "Node metadata" }),
}).openapi("NodeSelfRegisterRequest");

export type NodeSelfRegisterRequest = z.infer<typeof NodeSelfRegisterSchema>;

export const NodeSelfRegisterResponseSchema = z.object({
  node_id: z.string().openapi({ description: "Node identifier", example: "node_abc12345678901234567" }),
  token: z.string().openapi({ description: "Operational token (15min TTL)", example: "sk_abc12345678901234567" }),
  expires_at: z.string().datetime().openapi({ description: "ISO 8601 expiry timestamp", example: "2026-01-15T12:15:00Z" }),
}).openapi("NodeSelfRegisterResponse");

export const TokenRefreshResponseSchema = z.object({
  token: z.string().openapi({ description: "New operational token (15min TTL)", example: "sk_abc12345678901234567" }),
  expires_at: z.string().datetime().openapi({ description: "ISO 8601 expiry timestamp", example: "2026-01-15T12:30:00Z" }),
}).openapi("TokenRefreshResponse");
