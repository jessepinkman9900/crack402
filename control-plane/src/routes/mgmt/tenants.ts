import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { Env } from "../../types";
import { ErrorSchema, apiError } from "../../schemas/error";
import { createDb } from "../../db";
import { tenants, tenantApiKeys } from "../../db/schema";
import { generateTenantId, generateApiKeyToken } from "../../lib/id";
import { eq } from "drizzle-orm";

const app = new OpenAPIHono<Env>();

// --- Inline schemas for tenant routes ---

const CreateTenantSchema = z.object({
  name: z.string().openapi({ description: "Tenant name", example: "acme-corp" }),
  max_concurrent_sandboxes: z.number().optional().openapi({ description: "Max concurrent sandboxes" }),
  max_vcpu: z.number().optional().openapi({ description: "Max vCPU allocation" }),
  max_memory_mb: z.number().optional().openapi({ description: "Max memory in MB" }),
});

const UpdateTenantSchema = z.object({
  name: z.string().optional().openapi({ description: "Tenant name" }),
  status: z.string().optional().openapi({ description: "Tenant status" }),
  max_concurrent_sandboxes: z.number().optional().openapi({ description: "Max concurrent sandboxes" }),
  max_vcpu: z.number().optional().openapi({ description: "Max vCPU allocation" }),
  max_memory_mb: z.number().optional().openapi({ description: "Max memory in MB" }),
});

const CreateApiKeySchema = z.object({
  name: z.string().optional().openapi({ description: "API key name", example: "production-key" }),
});

const tenantIdParam = z.object({
  tenantId: z.string().openapi({ param: { name: "tenantId", in: "path" }, description: "Tenant ID" }),
});

// --- Route definitions ---

const createTenantRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Management (Tenants)"],
  summary: "Create a tenant",
  description: "Create a new tenant with an initial API key",
  security: [{ OperatorApiKey: [] }],
  request: {
    body: { content: { "application/json": { schema: CreateTenantSchema } } },
  },
  responses: {
    201: {
      description: "Tenant created",
      content: {
        "application/json": {
          schema: z.object({
            tenant_id: z.string(),
            name: z.string(),
            api_key: z.string(),
          }),
        },
      },
    },
    400: {
      description: "Invalid request",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});

const listTenantsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Management (Tenants)"],
  summary: "List tenants",
  description: "List all tenants",
  security: [{ OperatorApiKey: [] }],
  responses: {
    200: {
      description: "List of tenants",
      content: {
        "application/json": {
          schema: z.object({
            tenants: z.array(
              z.object({
                tenant_id: z.string(),
                name: z.string(),
                status: z.string(),
                max_concurrent_sandboxes: z.number(),
                max_vcpu: z.number(),
                max_memory_mb: z.number(),
                created_at: z.string(),
              })
            ),
          }),
        },
      },
    },
  },
});

const getTenantRoute = createRoute({
  method: "get",
  path: "/{tenantId}",
  tags: ["Management (Tenants)"],
  summary: "Get tenant details",
  description: "Get details for a specific tenant including quota usage",
  security: [{ OperatorApiKey: [] }],
  request: {
    params: tenantIdParam,
  },
  responses: {
    200: {
      description: "Tenant details",
      content: {
        "application/json": {
          schema: z.object({
            tenant_id: z.string(),
            name: z.string(),
            status: z.string(),
            max_concurrent_sandboxes: z.number(),
            max_vcpu: z.number(),
            max_memory_mb: z.number(),
            usage: z.any(),
            created_at: z.string(),
          }),
        },
      },
    },
    404: {
      description: "Tenant not found",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});

const updateTenantRoute = createRoute({
  method: "patch",
  path: "/{tenantId}",
  tags: ["Management (Tenants)"],
  summary: "Update a tenant",
  description: "Update tenant configuration and quota limits",
  security: [{ OperatorApiKey: [] }],
  request: {
    params: tenantIdParam,
    body: { content: { "application/json": { schema: UpdateTenantSchema } } },
  },
  responses: {
    200: {
      description: "Tenant updated",
      content: {
        "application/json": {
          schema: z.object({ ok: z.boolean() }),
        },
      },
    },
  },
});

const deleteTenantRoute = createRoute({
  method: "delete",
  path: "/{tenantId}",
  tags: ["Management (Tenants)"],
  summary: "Suspend a tenant",
  description: "Suspend a tenant (soft delete)",
  security: [{ OperatorApiKey: [] }],
  request: {
    params: tenantIdParam,
  },
  responses: {
    204: {
      description: "Tenant suspended",
    },
  },
});

const createApiKeyRoute = createRoute({
  method: "post",
  path: "/{tenantId}/api-keys",
  tags: ["Management (Tenants)"],
  summary: "Create an API key",
  description: "Create a new API key for a tenant",
  security: [{ OperatorApiKey: [] }],
  request: {
    params: tenantIdParam,
    body: { content: { "application/json": { schema: CreateApiKeySchema } } },
  },
  responses: {
    201: {
      description: "API key created",
      content: {
        "application/json": {
          schema: z.object({ key_id: z.string(), api_key: z.string() }),
        },
      },
    },
  },
});

// --- Handlers ---

// POST /v1/mgmt/tenants
app.openapi(createTenantRoute, async (c) => {
  const body = c.req.valid("json");

  if (!body.name) {
    return c.json(apiError("invalid_request", "Missing tenant name"), 400);
  }

  const tenantId = generateTenantId();
  const now = Date.now();
  const db = createDb(c.env.DB);

  await db.insert(tenants).values({
    id: tenantId,
    name: body.name,
    maxConcurrentSandboxes: body.max_concurrent_sandboxes || 10,
    maxVcpu: body.max_vcpu || 64,
    maxMemoryMb: body.max_memory_mb || 131072,
    createdAt: now,
  });

  // Initialize quota DO
  const quotaId = c.env.TENANT_QUOTA.idFromName(tenantId);
  const quotaStub = c.env.TENANT_QUOTA.get(quotaId);
  await quotaStub.fetch("http://do/init", {
    method: "POST",
    body: JSON.stringify({
      maxConcurrentSandboxes: body.max_concurrent_sandboxes || 10,
      maxVcpu: body.max_vcpu || 64,
      maxMemoryMb: body.max_memory_mb || 131072,
    }),
  });

  // Generate initial API key
  const apiKey = generateApiKeyToken();
  const keyId = generateApiKeyToken();
  await db.insert(tenantApiKeys).values({
    id: keyId,
    tenantId,
    keyHash: apiKey, // In production, hash this
    name: "default",
    createdAt: now,
  });

  // Store in KV
  await c.env.TENANT_KEYS.put(apiKey, tenantId);

  return c.json(
    {
      tenant_id: tenantId,
      name: body.name,
      api_key: apiKey,
    },
    201
  );
});

// GET /v1/mgmt/tenants
app.openapi(listTenantsRoute, async (c) => {
  const db = createDb(c.env.DB);
  const rows = await db.select().from(tenants);
  return c.json({
    tenants: rows.map((t) => ({
      tenant_id: t.id,
      name: t.name,
      status: t.status,
      max_concurrent_sandboxes: t.maxConcurrentSandboxes,
      max_vcpu: t.maxVcpu,
      max_memory_mb: t.maxMemoryMb,
      created_at: new Date(t.createdAt).toISOString(),
    })),
  });
});

// GET /v1/mgmt/tenants/:tenantId
app.openapi(getTenantRoute, async (c) => {
  const { tenantId } = c.req.valid("param");
  const db = createDb(c.env.DB);
  const rows = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (rows.length === 0) {
    return c.json(apiError("sandbox_not_found", `Tenant ${tenantId} not found`), 404) as any;
  }

  const t = rows[0];

  // Get quota usage from DO
  const quotaId = c.env.TENANT_QUOTA.idFromName(tenantId);
  const quotaStub = c.env.TENANT_QUOTA.get(quotaId);
  const quotaRes = await quotaStub.fetch("http://do/usage");
  const quota = await quotaRes.json();

  return c.json({
    tenant_id: t.id,
    name: t.name,
    status: t.status,
    max_concurrent_sandboxes: t.maxConcurrentSandboxes,
    max_vcpu: t.maxVcpu,
    max_memory_mb: t.maxMemoryMb,
    usage: quota,
    created_at: new Date(t.createdAt).toISOString(),
  }) as any;
});

// PATCH /v1/mgmt/tenants/:tenantId
app.openapi(updateTenantRoute, async (c) => {
  const { tenantId } = c.req.valid("param");
  const body = c.req.valid("json");
  const db = createDb(c.env.DB);

  const updates: Record<string, unknown> = {};
  if (body.name) updates.name = body.name;
  if (body.status) updates.status = body.status;
  if (body.max_concurrent_sandboxes) updates.maxConcurrentSandboxes = body.max_concurrent_sandboxes;
  if (body.max_vcpu) updates.maxVcpu = body.max_vcpu;
  if (body.max_memory_mb) updates.maxMemoryMb = body.max_memory_mb;

  await db.update(tenants).set(updates as any).where(eq(tenants.id, tenantId));

  // Update quota limits
  if (body.max_concurrent_sandboxes || body.max_vcpu || body.max_memory_mb) {
    const quotaId = c.env.TENANT_QUOTA.idFromName(tenantId);
    const quotaStub = c.env.TENANT_QUOTA.get(quotaId);
    await quotaStub.fetch("http://do/limits", {
      method: "PUT",
      body: JSON.stringify({
        maxConcurrentSandboxes: body.max_concurrent_sandboxes,
        maxVcpu: body.max_vcpu,
        maxMemoryMb: body.max_memory_mb,
      }),
    });
  }

  return c.json({ ok: true });
});

// DELETE /v1/mgmt/tenants/:tenantId
app.openapi(deleteTenantRoute, async (c) => {
  const { tenantId } = c.req.valid("param");
  const db = createDb(c.env.DB);
  await db.update(tenants).set({ status: "suspended" } as any).where(eq(tenants.id, tenantId));
  return c.body(null, 204);
});

// POST /v1/mgmt/tenants/:tenantId/api-keys
app.openapi(createApiKeyRoute, async (c) => {
  const { tenantId } = c.req.valid("param");
  const body = c.req.valid("json");
  const db = createDb(c.env.DB);

  const apiKey = generateApiKeyToken();
  const keyId = generateApiKeyToken();
  await db.insert(tenantApiKeys).values({
    id: keyId,
    tenantId,
    keyHash: apiKey,
    name: body.name || "api-key",
    createdAt: Date.now(),
  });

  await c.env.TENANT_KEYS.put(apiKey, tenantId);

  return c.json({ key_id: keyId, api_key: apiKey }, 201);
});

export default app;
