import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { Env } from "../../types";
import { WriteFileSchema, FileResponseSchema, FileListResponseSchema } from "../../schemas/files";
import { ErrorSchema, apiError } from "../../schemas/error";
import { createDb } from "../../db";
import { sandboxes } from "../../db/schema";
import { eq, and } from "drizzle-orm";

const app = new OpenAPIHono<Env>();

const sandboxIdParam = z.object({
  sandboxId: z.string().openapi({
    param: { name: "sandboxId", in: "path" },
    description: "Sandbox ID",
  }),
});

// ---------- POST /v1/sandboxes/:sandboxId/files ----------
const writeFileRoute = createRoute({
  method: "post",
  path: "/{sandboxId}/files",
  tags: ["Sandboxes"],
  summary: "Write a file",
  description: "Write a file to the sandbox filesystem.",
  security: [{ TenantApiKey: [] }],
  request: {
    params: sandboxIdParam,
    body: {
      content: {
        "application/json": {
          schema: WriteFileSchema as any,
        },
      },
      required: true,
    },
  },
  responses: {
    201: {
      description: "File written successfully",
      content: {
        "application/json": {
          schema: z.object({
            path: z.string(),
            size_bytes: z.number().int(),
          }),
        },
      },
    },
    400: {
      description: "Invalid request",
      content: { "application/json": { schema: ErrorSchema as any } },
    },
    404: {
      description: "Sandbox not found",
      content: { "application/json": { schema: ErrorSchema as any } },
    },
  },
});

app.openapi(writeFileRoute, async (c) => {
  const { sandboxId } = c.req.valid("param");
  const tenantId = c.get("tenantId")!;
  const body = c.req.valid("json");

  const sandbox = await verifySandbox(c, sandboxId, tenantId);
  if (!sandbox) {
    return c.json(apiError("sandbox_not_found", `Sandbox ${sandboxId} not found`), 404);
  }

  // Enqueue file write command to node
  const nodeManagerId = c.env.NODE_MANAGER.idFromName(sandbox.nodeId!);
  const nodeManagerStub = c.env.NODE_MANAGER.get(nodeManagerId);
  await nodeManagerStub.fetch("http://do/enqueue", {
    method: "POST",
    body: JSON.stringify({
      type: "exec",
      sandboxId,
      payload: {
        operation: "write_file",
        path: body.path,
        content: body.content,
        encoding: body.encoding,
        permissions: body.permissions,
      },
    }),
  });

  return c.json(
    {
      path: body.path,
      size_bytes: new TextEncoder().encode(body.content).length,
    },
    201
  );
});

// ---------- GET /v1/sandboxes/:sandboxId/files/* ----------
// Wildcard route kept as regular app.get() since OpenAPI doesn't support wildcards well
app.get("/:sandboxId/files/*", async (c) => {
  const sandboxId = c.req.param("sandboxId");
  const tenantId = c.get("tenantId")!;
  const filePath = "/" + (c.req.param("0") || c.req.url.split("/files/")[1] || "");

  const sandbox = await verifySandbox(c, sandboxId, tenantId);
  if (!sandbox) {
    return c.json(apiError("sandbox_not_found", `Sandbox ${sandboxId} not found`), 404);
  }

  // In production, this would proxy through the node agent
  return c.json({
    path: filePath,
    content: "",
    encoding: "utf-8",
    size_bytes: 0,
    mime_type: "application/octet-stream",
  });
});

// ---------- GET /v1/sandboxes/:sandboxId/files-list ----------
const listFilesRoute = createRoute({
  method: "get",
  path: "/{sandboxId}/files-list",
  tags: ["Sandboxes"],
  summary: "List files",
  description: "List files in a directory within the sandbox.",
  security: [{ TenantApiKey: [] }],
  request: {
    params: sandboxIdParam,
    query: z.object({
      directory: z.string().optional().openapi({ description: "Directory to list (default /workspace)" }),
    }),
  },
  responses: {
    200: {
      description: "File listing",
      content: {
        "application/json": { schema: FileListResponseSchema as any },
      },
    },
    404: {
      description: "Sandbox not found",
      content: { "application/json": { schema: ErrorSchema as any } },
    },
  },
});

app.openapi(listFilesRoute, async (c) => {
  const { sandboxId } = c.req.valid("param");
  const tenantId = c.get("tenantId")!;
  const query = c.req.valid("query");
  const directory = query.directory || "/workspace";

  const sandbox = await verifySandbox(c, sandboxId, tenantId);
  if (!sandbox) {
    return c.json(apiError("sandbox_not_found", `Sandbox ${sandboxId} not found`), 404);
  }

  return c.json({
    directory,
    files: [],
  });
});

async function verifySandbox(c: any, sandboxId: string, tenantId: string) {
  const db = createDb(c.env.DB);
  const rows = await db
    .select()
    .from(sandboxes)
    .where(and(eq(sandboxes.id, sandboxId), eq(sandboxes.tenantId, tenantId)))
    .limit(1);
  return rows[0] || null;
}

export default app;
