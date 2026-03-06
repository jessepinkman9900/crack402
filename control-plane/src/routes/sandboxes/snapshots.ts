import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { Env } from "../../types";
import { CreateSnapshotSchema, SnapshotSchema, FromSnapshotSchema } from "../../schemas/snapshot";
import { ErrorSchema, apiError } from "../../schemas/error";
import { createDb } from "../../db";
import { sandboxes, snapshots } from "../../db/schema";
import { generateSnapshotId, generateSandboxId } from "../../lib/id";
import { eq, and } from "drizzle-orm";

const app = new OpenAPIHono<Env>();

// ---------- POST /v1/sandboxes/:sandboxId/snapshots ----------
const createSnapshotRoute = createRoute({
  method: "post",
  path: "/{sandboxId}/snapshots",
  tags: ["Sandboxes"],
  summary: "Create a snapshot",
  description: "Create a snapshot of a sandbox's current state.",
  security: [{ TenantApiKey: [] }],
  request: {
    params: z.object({
      sandboxId: z.string().openapi({
        param: { name: "sandboxId", in: "path" },
        description: "Sandbox ID",
      }),
    }),
    body: {
      content: {
        "application/json": {
          schema: CreateSnapshotSchema as any,
        },
      },
      required: false,
    },
  },
  responses: {
    201: {
      description: "Snapshot created",
      content: {
        "application/json": { schema: SnapshotSchema as any },
      },
    },
    404: {
      description: "Sandbox not found",
      content: { "application/json": { schema: ErrorSchema as any } },
    },
    409: {
      description: "Sandbox state conflict",
      content: { "application/json": { schema: ErrorSchema as any } },
    },
  },
});

app.openapi(createSnapshotRoute, async (c) => {
  const { sandboxId } = c.req.valid("param");
  const tenantId = c.get("tenantId")!;
  const body = await c.req.json().catch(() => ({}));
  const parsed = (CreateSnapshotSchema as any).safeParse(body);

  const db = createDb(c.env.DB);
  const rows = await db
    .select()
    .from(sandboxes)
    .where(and(eq(sandboxes.id, sandboxId), eq(sandboxes.tenantId, tenantId)))
    .limit(1);

  if (rows.length === 0) {
    return c.json(apiError("sandbox_not_found", `Sandbox ${sandboxId} not found`), 404);
  }

  const sandbox = rows[0];
  if (sandbox.status === "destroyed") {
    return c.json(apiError("sandbox_state_conflict", "Cannot snapshot a destroyed sandbox"), 409);
  }

  const snapshotId = generateSnapshotId();
  const now = Date.now();

  // Enqueue snapshot command
  if (sandbox.nodeId) {
    const nodeManagerId = c.env.NODE_MANAGER.idFromName(sandbox.nodeId);
    const nodeManagerStub = c.env.NODE_MANAGER.get(nodeManagerId);
    await nodeManagerStub.fetch("http://do/enqueue", {
      method: "POST",
      body: JSON.stringify({
        type: "snapshot_sandbox",
        sandboxId,
        payload: { snapshot_id: snapshotId },
      }),
    });
  }

  await db.insert(snapshots).values({
    id: snapshotId,
    sandboxId,
    tenantId,
    name: parsed.success ? parsed.data.name : undefined,
    metadata: parsed.success && parsed.data.metadata ? JSON.stringify(parsed.data.metadata) : null,
    createdAt: now,
  });

  return c.json(
    {
      snapshot_id: snapshotId,
      sandbox_id: sandboxId,
      name: parsed.success ? parsed.data.name : undefined,
      created_at: new Date(now).toISOString(),
      size_bytes: 0,
      metadata: parsed.success ? parsed.data.metadata : undefined,
      expires_at: null,
    },
    201
  );
});

// ---------- POST /v1/sandboxes/from-snapshot ----------
const fromSnapshotRoute = createRoute({
  method: "post",
  path: "/from-snapshot",
  tags: ["Sandboxes"],
  summary: "Create sandbox from snapshot",
  description: "Create a new sandbox from an existing snapshot.",
  security: [{ TenantApiKey: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: FromSnapshotSchema as any,
        },
      },
      required: true,
    },
  },
  responses: {
    201: {
      description: "Sandbox created from snapshot",
      content: {
        "application/json": {
          schema: z.object({
            sandbox_id: z.string(),
            status: z.string(),
            base_image: z.string(),
            created_at: z.string(),
          }),
        },
      },
    },
    400: {
      description: "Invalid request",
      content: { "application/json": { schema: ErrorSchema as any } },
    },
    404: {
      description: "Snapshot not found",
      content: { "application/json": { schema: ErrorSchema as any } },
    },
    500: {
      description: "Internal error",
      content: { "application/json": { schema: ErrorSchema as any } },
    },
  },
});

app.openapi(fromSnapshotRoute, async (c) => {
  const req = c.req.valid("json");
  const tenantId = c.get("tenantId")!;
  const db = createDb(c.env.DB);

  // Find the snapshot
  const snapshotRows = await db
    .select()
    .from(snapshots)
    .where(and(eq(snapshots.id, req.snapshot_id), eq(snapshots.tenantId, tenantId)))
    .limit(1);

  if (snapshotRows.length === 0) {
    return c.json(apiError("sandbox_not_found", `Snapshot ${req.snapshot_id} not found`), 404);
  }

  // Find the original sandbox to get config
  const originalRows = await db
    .select()
    .from(sandboxes)
    .where(eq(sandboxes.id, snapshotRows[0].sandboxId))
    .limit(1);

  if (originalRows.length === 0) {
    return c.json(apiError("internal_error", "Original sandbox not found"), 500);
  }

  const original = originalRows[0];
  const sandboxId = generateSandboxId();
  const now = Date.now();
  const timeoutSeconds = req.override_timeout_seconds || original.timeoutSeconds;

  await db.insert(sandboxes).values({
    id: sandboxId,
    tenantId,
    status: "provisioning",
    baseImage: original.baseImage,
    vcpu: original.vcpu,
    memoryMb: original.memoryMb,
    gpu: original.gpu,
    timeoutSeconds,
    idleTimeoutSeconds: original.idleTimeoutSeconds,
    networkPolicy: original.networkPolicy,
    metadata: req.metadata ? JSON.stringify(req.metadata) : original.metadata,
    createdAt: now,
    expiresAt: now + timeoutSeconds * 1000,
  });

  return c.json(
    {
      sandbox_id: sandboxId,
      status: "provisioning",
      base_image: original.baseImage,
      created_at: new Date(now).toISOString(),
    },
    201
  );
});

export default app;
