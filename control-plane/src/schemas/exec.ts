import { z } from "zod/v4";
import { LanguageSchema } from "./sandbox";

export const ExecRequestSchema = z.object({
  type: z.enum(["code", "command", "file"]).openapi({ description: "Execution type", example: "code" }),
  code: z.string().optional().openapi({ description: "Inline code to execute", example: "print('hello')" }),
  language: LanguageSchema.optional().openapi({ description: "Language for code execution" }),
  command: z.union([z.string(), z.array(z.string())]).optional().openapi({ description: "Shell command to run", example: "ls -la" }),
  file_path: z.string().optional().openapi({ description: "Path to a script file to execute", example: "/workspace/script.py" }),
  args: z.array(z.string()).optional().openapi({ description: "Arguments to pass to the command or script", example: ["--verbose"] }),
  working_dir: z.string().default("/workspace").openapi({ description: "Working directory for execution", example: "/workspace" }),
  env_vars: z.record(z.string(), z.string()).optional().openapi({ description: "Environment variables for this execution" }),
  timeout_seconds: z.number().int().min(1).max(86400).default(300).openapi({ description: "Execution timeout in seconds", example: 300 }),
  stdin: z.string().optional().openapi({ description: "Standard input to pipe to the process" }),
  async: z.boolean().default(false).openapi({ description: "Run asynchronously and return immediately", example: false }),
}).openapi("ExecRequest");

export type ExecRequest = z.infer<typeof ExecRequestSchema>;

export const ExecStatusSchema = z.enum([
  "running", "completed", "failed", "timed_out", "cancelled",
]).openapi("ExecStatus");

export const ArtifactSchema = z.object({
  path: z.string().openapi({ description: "File path of the artifact", example: "/workspace/output.csv" }),
  size_bytes: z.number().int().openapi({ description: "Artifact size in bytes", example: 4096 }),
  mime_type: z.string().openapi({ description: "MIME type of the artifact", example: "text/csv" }),
  download_url: z.string().optional().openapi({ description: "URL to download the artifact" }),
}).openapi("Artifact");

export const ExecResultSchema = z.object({
  exec_id: z.string().openapi({ description: "Unique execution identifier", example: "exec_abc12345678901234567" }),
  status: ExecStatusSchema.openapi({ description: "Current execution status" }),
  exit_code: z.number().int().nullable().openapi({ description: "Process exit code, null if still running", example: 0 }),
  stdout: z.string().openapi({ description: "Standard output from the execution" }),
  stderr: z.string().openapi({ description: "Standard error from the execution" }),
  duration_ms: z.number().int().openapi({ description: "Execution duration in milliseconds", example: 1523 }),
  started_at: z.string().datetime().openapi({ description: "ISO 8601 execution start timestamp", example: "2026-01-15T12:00:00Z" }),
  completed_at: z.string().datetime().nullable().openapi({ description: "ISO 8601 completion timestamp, null if still running" }),
  artifacts: z.array(ArtifactSchema).optional().openapi({ description: "Files produced by the execution" }),
}).openapi("ExecResult");

export type ExecResult = z.infer<typeof ExecResultSchema>;
