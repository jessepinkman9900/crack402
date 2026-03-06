import "./_setup";
import { z } from "zod/v4";

export const SandboxIdSchema = z.string().regex(/^sbx_[a-zA-Z0-9]{20,}$/).openapi({ description: "Unique sandbox identifier", example: "sbx_abc12345678901234567" });
export const ExecIdSchema = z.string().regex(/^exec_[a-zA-Z0-9]{20,}$/).openapi({ description: "Unique execution identifier", example: "exec_abc12345678901234567" });
export const SnapshotIdSchema = z.string().regex(/^snap_[a-zA-Z0-9]{20,}$/).openapi({ description: "Unique snapshot identifier", example: "snap_abc12345678901234567" });
export const NodeIdSchema = z.string().regex(/^node_[a-zA-Z0-9]{20,}$/).openapi({ description: "Unique node identifier", example: "node_abc12345678901234567" });
export const CommandIdSchema = z.string().regex(/^cmd_[a-zA-Z0-9]{20,}$/).openapi({ description: "Unique command identifier", example: "cmd_abc12345678901234567" });
export const WebhookIdSchema = z.string().regex(/^wh_[a-zA-Z0-9]{20,}$/).openapi({ description: "Unique webhook identifier", example: "wh_abc12345678901234567" });
export const TenantIdSchema = z.string().regex(/^ten_[a-zA-Z0-9]{20,}$/).openapi({ description: "Unique tenant identifier", example: "ten_abc12345678901234567" });

export const PaginationSchema = z.object({
  limit: z.number().int().min(1).max(200).default(50).openapi({ description: "Maximum number of items to return", example: 50 }),
  cursor: z.string().optional().openapi({ description: "Opaque cursor for pagination", example: "eyJpZCI6MTAwfQ" }),
}).openapi("Pagination");

export const PaginatedResponseSchema = <T extends z.ZodType>(itemSchema: T) =>
  z.object({
    items: z.array(itemSchema).openapi({ description: "List of items in the current page" }),
    next_cursor: z.string().nullable().openapi({ description: "Cursor for the next page, null if no more pages" }),
    total_count: z.number().int().openapi({ description: "Total number of items across all pages", example: 42 }),
  });

export const MetadataSchema = z.record(z.string(), z.string()).openapi({ description: "Arbitrary key-value metadata", example: { env: "production", team: "backend" } });

export const TimestampSchema = z.string().datetime().openapi({ description: "ISO 8601 timestamp", example: "2026-01-15T12:00:00Z" });
