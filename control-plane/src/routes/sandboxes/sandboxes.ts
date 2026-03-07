import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { Env } from "../../types";
import { CreateSandboxRequestSchema, SandboxSchema } from "../../schemas/sandbox";
import { ErrorSchema, apiError } from "../../schemas/error";
import { createDb } from "../../db";
import { sandboxes } from "../../db/schema";
import { generateSandboxId } from "../../lib/id";
import { eq, and } from "drizzle-orm";
import { writeSandboxLifecyclePoint } from "../../lib/analytics";

const app = new OpenAPIHono<Env>();

// ---------- POST /v1/sandboxes ----------
const createSandboxRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Sandboxes"],
  summary: "Create a new sandbox",
  description: "Provision a new sandbox with the specified configuration.",
  security: [{ TenantApiKey: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: CreateSandboxRequestSchema as any,
        },
      },
      required: true,
    },
  },
  responses: {
    201: {
      description: "Sandbox created successfully",
      content: {
        "application/json": {
          schema: SandboxSchema as any,
        },
      },
    },
    400: {
      description: "Invalid request body",
      content: { "application/json": { schema: ErrorSchema as any } },
    },
    429: {
      description: "Resource limit exceeded",
      content: { "application/json": { schema: ErrorSchema as any } },
    },
    503: {
      description: "No capacity available",
      content: { "application/json": { schema: ErrorSchema as any } },
    },
  },
});

app.openapi(createSandboxRoute, async (c) => {
  const req = c.req.valid("json");
  const tenantId = c.get("tenantId")!;

  // 1. Check quota via TenantQuotaDO
  const quotaId = c.env.TENANT_QUOTA.idFromName(tenantId);
  const quotaStub = c.env.TENANT_QUOTA.get(quotaId);
  const quotaRes = await quotaStub.fetch("http://do/check", {
    method: "POST",
    body: JSON.stringify({ vcpu: req.vcpu, memoryMb: req.memory_mb }),
  });
  if (!quotaRes.ok) {
    const err = await quotaRes.json() as { error: string; message: string };
    return c.json(apiError("resource_limit_exceeded", err.message), 429);
  }

  // 2. Place via GlobalSchedulerDO
  const schedulerId = c.env.GLOBAL_SCHEDULER.idFromName("global");
  const schedulerStub = c.env.GLOBAL_SCHEDULER.get(schedulerId);
  const placeRes = await schedulerStub.fetch("http://do/place", {
    method: "POST",
    body: JSON.stringify({
      vcpu: req.vcpu,
      memoryMb: req.memory_mb,
      gpu: req.gpu,
    }),
  });
  if (!placeRes.ok) {
    // Release quota reservation
    await quotaStub.fetch("http://do/release", {
      method: "POST",
      body: JSON.stringify({ vcpu: req.vcpu, memoryMb: req.memory_mb }),
    });
    return c.json(apiError("capacity_exhausted", "No nodes with sufficient capacity"), 503);
  }
  const { nodeId, region } = (await placeRes.json()) as { nodeId: string; region: string };

  // 3. Allocate resources on scheduler with sandbox timeout as the reservation TTL
  const sandboxId = generateSandboxId();
  await schedulerStub.fetch("http://do/allocate", {
    method: "POST",
    body: JSON.stringify({ sandboxId, nodeId, vcpu: req.vcpu, memoryMb: req.memory_mb, timeoutMs: req.timeout_seconds * 1000 }),
  });

  // 4. Create SandboxTrackerDO
  const trackerId = c.env.SANDBOX_TRACKER.idFromName(sandboxId);
  const trackerStub = c.env.SANDBOX_TRACKER.get(trackerId);
  await trackerStub.fetch("http://do/init", {
    method: "POST",
    body: JSON.stringify({
      sandboxId,
      tenantId,
      nodeId,
      baseImage: req.base_image,
      vcpu: req.vcpu,
      memoryMb: req.memory_mb,
      gpu: req.gpu || null,
      timeoutSeconds: req.timeout_seconds,
      idleTimeoutSeconds: req.idle_timeout_seconds,
      autoPauseOnIdle: req.auto_pause_on_idle,
      autoDestroy: req.auto_destroy,
    }),
  });

  // 5. Enqueue create_sandbox command via NodeManagerDO
  const nodeManagerId = c.env.NODE_MANAGER.idFromName(nodeId);
  const nodeManagerStub = c.env.NODE_MANAGER.get(nodeManagerId);
  await nodeManagerStub.fetch("http://do/enqueue", {
    method: "POST",
    body: JSON.stringify({
      type: "create_sandbox",
      sandboxId,
      payload: {
        base_image: req.base_image,
        vcpu: req.vcpu,
        memory_mb: req.memory_mb,
        gpu: req.gpu,
        env_vars: req.env_vars,
        network_policy: req.network_policy,
        github_repo: req.github_repo,
        code: req.code,
        language: req.language,
      },
    }),
  });

  // 6. Write to D1
  const now = Date.now();
  const db = createDb(c.env.DB);
  await db.insert(sandboxes).values({
    id: sandboxId,
    tenantId,
    nodeId,
    status: "provisioning",
    baseImage: req.base_image,
    vcpu: req.vcpu,
    memoryMb: req.memory_mb,
    gpu: req.gpu || null,
    timeoutSeconds: req.timeout_seconds,
    idleTimeoutSeconds: req.idle_timeout_seconds,
    autoPauseOnIdle: req.auto_pause_on_idle ? 1 : 0,
    autoDestroy: req.auto_destroy ? 1 : 0,
    networkPolicy: req.network_policy,
    envVars: req.env_vars ? JSON.stringify(req.env_vars) : null,
    metadata: req.metadata ? JSON.stringify(req.metadata) : null,
    region,
    createdAt: now,
    expiresAt: now + req.timeout_seconds * 1000,
  });

  // Write lifecycle data point (fire-and-forget)
  writeSandboxLifecyclePoint(c.env.AE_SANDBOX_LIFECYCLE, {
    tenantId,
    sandboxId,
    fromStatus: "",
    toStatus: "provisioning",
    event: "create",
    baseImage: req.base_image,
    nodeId,
    region,
    networkPolicy: req.network_policy ?? "outbound-only",
    vcpu: req.vcpu,
    memoryMb: req.memory_mb,
    durationMs: 0,
  });

  c.header("Location", `/v1/sandboxes/${sandboxId}`);
  return c.json(
    {
      sandbox_id: sandboxId,
      status: "provisioning" as const,
      base_image: req.base_image,
      vcpu: req.vcpu,
      memory_mb: req.memory_mb,
      gpu: req.gpu || null,
      timeout_seconds: req.timeout_seconds,
      idle_timeout_seconds: req.idle_timeout_seconds,
      network_policy: req.network_policy,
      metadata: req.metadata,
      created_at: new Date(now).toISOString(),
      started_at: null,
      region,
    },
    201
  );
});

// ---------- GET /v1/sandboxes ----------
const listSandboxesRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Sandboxes"],
  summary: "List sandboxes",
  description: "List all sandboxes for the authenticated tenant.",
  security: [{ TenantApiKey: [] }],
  request: {
    query: z.object({
      status: z.string().optional().openapi({ description: "Filter by sandbox status" }),
      limit: z.string().optional().openapi({ description: "Maximum number of results", example: "50" }),
      cursor: z.string().optional().openapi({ description: "Pagination cursor" }),
    }),
  },
  responses: {
    200: {
      description: "List of sandboxes",
      content: {
        "application/json": {
          schema: z.object({
            sandboxes: z.array(SandboxSchema as any),
            next_cursor: z.string().nullable(),
            total_count: z.number().int(),
          }),
        },
      },
    },
  },
});

app.openapi(listSandboxesRoute, async (c) => {
  const tenantId = c.get("tenantId")!;
  const query = c.req.valid("query");
  const status = query.status;
  const limit = parseInt(query.limit || "50", 10);
  const cursor = query.cursor;

  const db = createDb(c.env.DB);

  const conditions = [eq(sandboxes.tenantId, tenantId)];
  if (status) {
    conditions.push(eq(sandboxes.status, status as any));
  }

  const rows = await db
    .select()
    .from(sandboxes)
    .where(and(...conditions))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;

  return c.json({
    sandboxes: items.map(formatSandbox),
    next_cursor: hasMore ? items[items.length - 1].id : null,
    total_count: items.length,
  });
});

// ---------- GET /v1/sandboxes/:sandboxId ----------
const getSandboxRoute = createRoute({
  method: "get",
  path: "/{sandboxId}",
  tags: ["Sandboxes"],
  summary: "Get sandbox details",
  description: "Retrieve details for a specific sandbox.",
  security: [{ TenantApiKey: [] }],
  request: {
    params: z.object({
      sandboxId: z.string().openapi({
        param: { name: "sandboxId", in: "path" },
        description: "Sandbox ID",
      }),
    }),
  },
  responses: {
    200: {
      description: "Sandbox details",
      content: {
        "application/json": {
          schema: SandboxSchema as any,
        },
      },
    },
    404: {
      description: "Sandbox not found",
      content: { "application/json": { schema: ErrorSchema as any } },
    },
  },
});

app.openapi(getSandboxRoute, async (c) => {
  const { sandboxId } = c.req.valid("param");
  const tenantId = c.get("tenantId")!;

  const db = createDb(c.env.DB);
  const rows = await db
    .select()
    .from(sandboxes)
    .where(and(eq(sandboxes.id, sandboxId), eq(sandboxes.tenantId, tenantId)))
    .limit(1);

  if (rows.length === 0) {
    return c.json(apiError("sandbox_not_found", `Sandbox ${sandboxId} not found`), 404);
  }

  return c.json(formatSandbox(rows[0]));
});

// ---------- DELETE /v1/sandboxes/:sandboxId ----------
const deleteSandboxRoute = createRoute({
  method: "delete",
  path: "/{sandboxId}",
  tags: ["Sandboxes"],
  summary: "Destroy a sandbox",
  description: "Permanently destroy a sandbox and release its resources.",
  security: [{ TenantApiKey: [] }],
  request: {
    params: z.object({
      sandboxId: z.string().openapi({
        param: { name: "sandboxId", in: "path" },
        description: "Sandbox ID",
      }),
    }),
  },
  responses: {
    204: {
      description: "Sandbox destroyed",
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

app.openapi(deleteSandboxRoute, async (c) => {
  const { sandboxId } = c.req.valid("param");
  const tenantId = c.get("tenantId")!;

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
    return c.json(apiError("sandbox_state_conflict", "Sandbox is already destroyed"), 409);
  }

  // Transition via SandboxTrackerDO
  const trackerId = c.env.SANDBOX_TRACKER.idFromName(sandboxId);
  const trackerStub = c.env.SANDBOX_TRACKER.get(trackerId);
  const transitionRes = await trackerStub.fetch("http://do/transition", {
    method: "POST",
    body: JSON.stringify({ event: "destroy" }),
  });

  if (!transitionRes.ok) {
    const err = await transitionRes.json() as { error: string };
    return c.json(apiError("sandbox_state_conflict", err.error), 409);
  }

  // Release scheduler reservation by sandboxId
  const schedulerId = c.env.GLOBAL_SCHEDULER.idFromName("global");
  const schedulerStub = c.env.GLOBAL_SCHEDULER.get(schedulerId);
  await schedulerStub.fetch("http://do/release", {
    method: "POST",
    body: JSON.stringify({ sandboxId }),
  });

  // Cancel any pending commands for this sandbox (e.g. create_sandbox not yet picked up)
  if (sandbox.nodeId) {
    const nodeManagerId = c.env.NODE_MANAGER.idFromName(sandbox.nodeId);
    const nodeManagerStub = c.env.NODE_MANAGER.get(nodeManagerId);
    await nodeManagerStub.fetch(`http://do/cancel-sandbox/${sandboxId}`, { method: "POST" });
  }

  // Update D1
  const destroyedAt = Date.now();
  await db
    .update(sandboxes)
    .set({ status: "destroyed", destroyedAt })
    .where(eq(sandboxes.id, sandboxId));

  // Write lifecycle data point (fire-and-forget)
  writeSandboxLifecyclePoint(c.env.AE_SANDBOX_LIFECYCLE, {
    tenantId,
    sandboxId,
    fromStatus: sandbox.status,
    toStatus: "destroyed",
    event: "destroy",
    baseImage: sandbox.baseImage,
    nodeId: sandbox.nodeId ?? "",
    region: sandbox.region ?? "",
    networkPolicy: sandbox.networkPolicy,
    vcpu: sandbox.vcpu,
    memoryMb: sandbox.memoryMb,
    durationMs: destroyedAt - sandbox.createdAt,
  });

  return c.body(null, 204);
});

function formatSandbox(row: typeof sandboxes.$inferSelect) {
  return {
    sandbox_id: row.id,
    status: row.status,
    base_image: row.baseImage,
    vcpu: row.vcpu,
    memory_mb: row.memoryMb,
    gpu: row.gpu,
    timeout_seconds: row.timeoutSeconds,
    idle_timeout_seconds: row.idleTimeoutSeconds,
    network_policy: row.networkPolicy,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    created_at: new Date(row.createdAt).toISOString(),
    started_at: row.startedAt ? new Date(row.startedAt).toISOString() : null,
    expires_at: row.expiresAt ? new Date(row.expiresAt).toISOString() : undefined,
    region: row.region,
    cost_accrued_usd: row.costAccruedUsd ? row.costAccruedUsd / 1_000_000 : 0,
  };
}

export default app;
