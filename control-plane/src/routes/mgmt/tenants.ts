import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { nanoid } from "nanoid";
import type { Env } from "../../types";
import { ErrorSchema, apiError } from "../../schemas/error";

const app = new OpenAPIHono<Env>();

// --- Quota metadata shape stored in organization.metadata ---

const QuotaSchema = z.object({
  max_concurrent_sandboxes: z.number().openapi({ description: "Max concurrent sandboxes", example: 10 }),
  max_vcpu: z.number().openapi({ description: "Max vCPU allocation", example: 64 }),
  max_memory_mb: z.number().openapi({ description: "Max memory in MB", example: 131072 }),
});

const OrgResponseSchema = z.object({
  org_id: z.string(),
  name: z.string(),
  slug: z.string(),
  status: z.enum(["active", "suspended"]),
  max_concurrent_sandboxes: z.number(),
  max_vcpu: z.number(),
  max_memory_mb: z.number(),
  created_at: z.string(),
});

const orgIdParam = z.object({
  orgId: z.string().openapi({ param: { name: "orgId", in: "path" }, description: "Organization ID" }),
});

// --- Routes ---

const createOrgRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Management (Tenants)"],
  summary: "Create an organization",
  description: "Create a new org (tenant) with quota limits stored in metadata",
  security: [{ OperatorApiKey: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            name: z.string().openapi({ example: "acme-corp" }),
            user_id: z.string().optional().openapi({ description: "Owner user ID" }),
          }).merge(QuotaSchema.partial()),
        },
      },
    },
  },
  responses: {
    201: {
      description: "Organization created",
      content: {
        "application/json": {
          schema: z.object({
            org_id: z.string(),
            name: z.string(),
            api_key: z.string(),
          }),
        },
      },
    },
    400: { description: "Invalid request", content: { "application/json": { schema: ErrorSchema } } },
  },
});

const listOrgsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Management (Tenants)"],
  summary: "List organizations",
  security: [{ OperatorApiKey: [] }],
  responses: {
    200: {
      description: "List of organizations",
      content: {
        "application/json": {
          schema: z.object({ tenants: z.array(OrgResponseSchema) }),
        },
      },
    },
  },
});

const getOrgRoute = createRoute({
  method: "get",
  path: "/{orgId}",
  tags: ["Management (Tenants)"],
  summary: "Get organization",
  description: "Get org details including quota limits and current usage",
  security: [{ OperatorApiKey: [] }],
  request: { params: orgIdParam },
  responses: {
    200: {
      description: "Organization details",
      content: {
        "application/json": {
          schema: OrgResponseSchema.extend({ usage: z.any() }),
        },
      },
    },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});

const updateOrgRoute = createRoute({
  method: "patch",
  path: "/{orgId}",
  tags: ["Management (Tenants)"],
  summary: "Update organization quota",
  security: [{ OperatorApiKey: [] }],
  request: {
    params: orgIdParam,
    body: {
      content: {
        "application/json": {
          schema: z.object({
            name: z.string().optional(),
            status: z.enum(["active", "suspended"]).optional(),
          }).merge(QuotaSchema.partial()),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Updated",
      content: { "application/json": { schema: z.object({ ok: z.boolean() }) } },
    },
  },
});

const deleteOrgRoute = createRoute({
  method: "delete",
  path: "/{orgId}",
  tags: ["Management (Tenants)"],
  summary: "Suspend an organization",
  security: [{ OperatorApiKey: [] }],
  request: { params: orgIdParam },
  responses: {
    204: { description: "Suspended" },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});

const createApiKeyRoute = createRoute({
  method: "post",
  path: "/{orgId}/api-keys",
  tags: ["Management (Tenants)"],
  summary: "Create an API key for an organization",
  security: [{ OperatorApiKey: [] }],
  request: {
    params: orgIdParam,
    body: {
      content: {
        "application/json": {
          schema: z.object({ name: z.string().optional() }),
        },
      },
    },
  },
  responses: {
    201: {
      description: "API key created",
      content: {
        "application/json": {
          schema: z.object({ api_key: z.string() }),
        },
      },
    },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});

// --- Helpers ---

function parseQuota(metadata: string | null) {
  try {
    return metadata ? JSON.parse(metadata) : {};
  } catch {
    return {};
  }
}

function mergeQuota(existing: Record<string, unknown>, updates: Record<string, unknown>) {
  return {
    maxConcurrentSandboxes: updates.maxConcurrentSandboxes ?? existing.maxConcurrentSandboxes ?? 10,
    maxVcpu: updates.maxVcpu ?? existing.maxVcpu ?? 64,
    maxMemoryMb: updates.maxMemoryMb ?? existing.maxMemoryMb ?? 131072,
    status: updates.status ?? existing.status ?? "active",
  };
}

// --- Handlers ---

app.openapi(createOrgRoute, async (c) => {
  const body = c.req.valid("json");

  if (!body.name) return c.json(apiError("invalid_request", "Missing name"), 400);

  const orgId = `org_${nanoid(20)}`;
  const now = new Date().toISOString();
  const metadata = JSON.stringify({
    maxConcurrentSandboxes: body.max_concurrent_sandboxes ?? 10,
    maxVcpu: body.max_vcpu ?? 64,
    maxMemoryMb: body.max_memory_mb ?? 131072,
    status: "active",
  });

  await c.env.DB.prepare(
    "INSERT INTO organization (id, name, slug, created_at, metadata) VALUES (?, ?, ?, ?, ?)"
  ).bind(orgId, body.name, body.name.toLowerCase().replace(/[^a-z0-9-]/g, "-"), now, metadata).run();

  if (body.user_id) {
    await c.env.DB.prepare(
      "INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES (?, ?, ?, 'owner', ?)"
    ).bind(`mem_${nanoid(20)}`, orgId, body.user_id, now).run();
  }

  // Init quota DO
  const quotaId = c.env.TENANT_QUOTA.idFromName(orgId);
  await c.env.TENANT_QUOTA.get(quotaId).fetch("http://do/init", {
    method: "POST",
    body: JSON.stringify({
      maxConcurrentSandboxes: body.max_concurrent_sandboxes ?? 10,
      maxVcpu: body.max_vcpu ?? 64,
      maxMemoryMb: body.max_memory_mb ?? 131072,
    }),
  });

  // Generate machine API key in KV
  const apiKey = `key_${nanoid(32)}`;
  await c.env.TENANT_KEYS.put(apiKey, orgId);

  return c.json({ org_id: orgId, name: body.name, api_key: apiKey }, 201);
});

app.openapi(listOrgsRoute, async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT id, name, slug, created_at, metadata FROM organization"
  ).all<{ id: string; name: string; slug: string; created_at: string; metadata: string | null }>();

  return c.json({
    tenants: (rows.results ?? []).map((o) => {
      const q = parseQuota(o.metadata);
      return {
        org_id: o.id,
        name: o.name,
        slug: o.slug,
        status: (q.status ?? "active") as "active" | "suspended",
        max_concurrent_sandboxes: q.maxConcurrentSandboxes ?? 10,
        max_vcpu: q.maxVcpu ?? 64,
        max_memory_mb: q.maxMemoryMb ?? 131072,
        created_at: o.created_at,
      };
    }),
  });
});

app.openapi(getOrgRoute, async (c) => {
  const { orgId } = c.req.valid("param");
  const row = await c.env.DB.prepare(
    "SELECT id, name, slug, created_at, metadata FROM organization WHERE id = ?"
  ).bind(orgId).first<{ id: string; name: string; slug: string; created_at: string; metadata: string | null }>();

  if (!row) return c.json(apiError("not_found", `Organization ${orgId} not found`), 404) as any;

  const q = parseQuota(row.metadata);

  const quotaRes = await c.env.TENANT_QUOTA.get(c.env.TENANT_QUOTA.idFromName(orgId)).fetch("http://do/usage");
  const usage = await quotaRes.json();

  return c.json({
    org_id: row.id,
    name: row.name,
    slug: row.slug,
    status: (q.status ?? "active") as "active" | "suspended",
    max_concurrent_sandboxes: q.maxConcurrentSandboxes ?? 10,
    max_vcpu: q.maxVcpu ?? 64,
    max_memory_mb: q.maxMemoryMb ?? 131072,
    created_at: row.created_at,
    usage,
  }) as any;
});

app.openapi(updateOrgRoute, async (c) => {
  const { orgId } = c.req.valid("param");
  const body = c.req.valid("json");

  const row = await c.env.DB.prepare(
    "SELECT metadata FROM organization WHERE id = ?"
  ).bind(orgId).first<{ metadata: string | null }>();

  if (!row) return c.json(apiError("not_found", `Organization ${orgId} not found`), 404) as any;

  const existing = parseQuota(row.metadata);
  const updated = mergeQuota(existing, {
    maxConcurrentSandboxes: body.max_concurrent_sandboxes,
    maxVcpu: body.max_vcpu,
    maxMemoryMb: body.max_memory_mb,
    status: body.status,
  });

  const updates: string[] = ["metadata = ?"];
  const params: unknown[] = [JSON.stringify(updated)];
  if (body.name) { updates.push("name = ?"); params.push(body.name); }
  params.push(orgId);

  await c.env.DB.prepare(
    `UPDATE organization SET ${updates.join(", ")} WHERE id = ?`
  ).bind(...params).run();

  // Sync quota DO limits
  if (body.max_concurrent_sandboxes || body.max_vcpu || body.max_memory_mb) {
    await c.env.TENANT_QUOTA.get(c.env.TENANT_QUOTA.idFromName(orgId)).fetch("http://do/limits", {
      method: "PUT",
      body: JSON.stringify({
        maxConcurrentSandboxes: updated.maxConcurrentSandboxes,
        maxVcpu: updated.maxVcpu,
        maxMemoryMb: updated.maxMemoryMb,
      }),
    });
  }

  return c.json({ ok: true });
});

app.openapi(deleteOrgRoute, async (c) => {
  const { orgId } = c.req.valid("param");

  const row = await c.env.DB.prepare(
    "SELECT metadata FROM organization WHERE id = ?"
  ).bind(orgId).first<{ metadata: string | null }>();

  if (!row) return c.json(apiError("not_found", `Organization ${orgId} not found`), 404) as any;

  const existing = parseQuota(row.metadata);
  await c.env.DB.prepare(
    "UPDATE organization SET metadata = ? WHERE id = ?"
  ).bind(JSON.stringify({ ...existing, status: "suspended" }), orgId).run();

  return c.body(null, 204);
});

app.openapi(createApiKeyRoute, async (c) => {
  const { orgId } = c.req.valid("param");

  const row = await c.env.DB.prepare(
    "SELECT id FROM organization WHERE id = ?"
  ).bind(orgId).first<{ id: string }>();

  if (!row) return c.json(apiError("not_found", `Organization ${orgId} not found`), 404) as any;

  const apiKey = `key_${nanoid(32)}`;
  await c.env.TENANT_KEYS.put(apiKey, orgId);

  return c.json({ api_key: apiKey }, 201);
});

export default app;
