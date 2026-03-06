import "./_setup";
import { z } from "zod/v4";

export const NodeStatusSchema = z.enum([
  "healthy", "degraded", "draining", "cordoned", "offline",
]).openapi("NodeStatus");

export type NodeStatus = z.infer<typeof NodeStatusSchema>;

export const HeartbeatSchema = z.object({
  node_id: z.string().openapi({ description: "Node identifier", example: "node_abc12345678901234567" }),
  timestamp: z.string().datetime().openapi({ description: "ISO 8601 heartbeat timestamp", example: "2026-01-15T12:00:00Z" }),
  total_vcpu: z.number().openapi({ description: "Total vCPUs available on the node", example: 64 }),
  used_vcpu: z.number().openapi({ description: "Currently used vCPUs", example: 12 }),
  total_memory_mb: z.number().int().openapi({ description: "Total memory in MB", example: 262144 }),
  used_memory_mb: z.number().int().openapi({ description: "Currently used memory in MB", example: 65536 }),
  sandbox_count: z.number().int().openapi({ description: "Number of active sandboxes", example: 6 }),
  sandbox_ids: z.array(z.string()).openapi({ description: "IDs of active sandboxes on this node" }),
  firecracker_version: z.string().optional().openapi({ description: "Firecracker version", example: "1.7.0" }),
  disk_free_gb: z.number().optional().openapi({ description: "Free disk space in GB", example: 450.5 }),
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
