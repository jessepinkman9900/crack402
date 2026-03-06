import "./_setup";
import { z } from "zod/v4";

export const ErrorCodeSchema = z.enum([
  "invalid_request",
  "unauthorized",
  "forbidden",
  "sandbox_not_found",
  "sandbox_state_conflict",
  "exec_timeout",
  "resource_limit_exceeded",
  "capacity_exhausted",
  "payment_required",
  "rate_limited",
  "internal_error",
]).openapi("ErrorCode");

export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ErrorSchema = z.object({
  error: ErrorCodeSchema.openapi({ description: "Machine-readable error code", example: "sandbox_not_found" }),
  message: z.string().openapi({ description: "Human-readable error message", example: "The requested sandbox does not exist" }),
  details: z.record(z.string(), z.unknown()).optional().openapi({ description: "Additional error context" }),
  request_id: z.string().optional().openapi({ description: "Request ID for support reference", example: "req_abc123" }),
}).openapi("Error");

export type ApiError = z.infer<typeof ErrorSchema>;

export function apiError(
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
  requestId?: string
): ApiError {
  return {
    error: code,
    message,
    ...(details ? { details } : {}),
    ...(requestId ? { request_id: requestId } : {}),
  };
}
