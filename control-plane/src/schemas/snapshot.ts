import { z } from "zod/v4";
import { MetadataSchema } from "./common";

export const CreateSnapshotSchema = z.object({
  name: z.string().optional().openapi({ description: "Human-readable snapshot name", example: "pre-deploy-checkpoint" }),
  metadata: MetadataSchema.optional().openapi({ description: "Arbitrary key-value metadata" }),
}).openapi("CreateSnapshotRequest");

export type CreateSnapshotRequest = z.infer<typeof CreateSnapshotSchema>;

export const SnapshotSchema = z.object({
  snapshot_id: z.string().openapi({ description: "Unique snapshot identifier", example: "snap_abc12345678901234567" }),
  sandbox_id: z.string().openapi({ description: "ID of the sandbox this snapshot was taken from", example: "sbx_abc12345678901234567" }),
  name: z.string().optional().openapi({ description: "Snapshot name" }),
  created_at: z.string().datetime().openapi({ description: "ISO 8601 creation timestamp", example: "2026-01-15T12:00:00Z" }),
  size_bytes: z.number().int().openapi({ description: "Snapshot size in bytes", example: 536870912 }),
  metadata: MetadataSchema.optional().openapi({ description: "Arbitrary key-value metadata" }),
  expires_at: z.string().datetime().nullable().openapi({ description: "ISO 8601 expiration timestamp, null if no expiry" }),
}).openapi("Snapshot");

export type Snapshot = z.infer<typeof SnapshotSchema>;

export const FromSnapshotSchema = z.object({
  snapshot_id: z.string().openapi({ description: "Snapshot ID to restore from", example: "snap_abc12345678901234567" }),
  override_env_vars: z.record(z.string(), z.string()).optional().openapi({ description: "Environment variables to override from the snapshot" }),
  override_timeout_seconds: z.number().int().optional().openapi({ description: "Override the timeout from the snapshot", example: 7200 }),
  metadata: MetadataSchema.optional().openapi({ description: "Metadata for the new sandbox" }),
}).openapi("FromSnapshotRequest");

export type FromSnapshotRequest = z.infer<typeof FromSnapshotSchema>;
