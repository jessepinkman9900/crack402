import "./_setup";
import { z } from "zod/v4";

export const WriteFileSchema = z.object({
  path: z.string().openapi({ description: "Absolute file path inside the sandbox", example: "/workspace/main.py" }),
  content: z.string().openapi({ description: "File content" }),
  encoding: z.enum(["utf-8", "base64"]).default("utf-8").openapi({ description: "Content encoding", example: "utf-8" }),
  permissions: z.string().optional().openapi({ description: "Unix file permissions", example: "0644" }),
}).openapi("WriteFileRequest");

export type WriteFileRequest = z.infer<typeof WriteFileSchema>;

export const FileResponseSchema = z.object({
  path: z.string().openapi({ description: "Absolute file path", example: "/workspace/main.py" }),
  content: z.string().openapi({ description: "File content in the specified encoding" }),
  encoding: z.enum(["utf-8", "base64"]).openapi({ description: "Content encoding", example: "utf-8" }),
  size_bytes: z.number().int().openapi({ description: "File size in bytes", example: 1024 }),
  mime_type: z.string().openapi({ description: "Detected MIME type", example: "text/x-python" }),
}).openapi("FileResponse");

export const FileEntrySchema = z.object({
  path: z.string().openapi({ description: "File or directory path", example: "/workspace/src/index.ts" }),
  type: z.enum(["file", "directory", "symlink"]).openapi({ description: "Entry type", example: "file" }),
  size_bytes: z.number().int().openapi({ description: "Size in bytes (0 for directories)", example: 2048 }),
  modified_at: z.string().datetime().openapi({ description: "ISO 8601 last modified timestamp", example: "2026-01-15T12:00:00Z" }),
}).openapi("FileEntry");

export const FileListResponseSchema = z.object({
  directory: z.string().openapi({ description: "Listed directory path", example: "/workspace" }),
  files: z.array(FileEntrySchema).openapi({ description: "Files and directories in the listed path" }),
}).openapi("FileListResponse");
