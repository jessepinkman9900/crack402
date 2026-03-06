import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { Env } from "../../types";
import { CreateWebhookSchema, WebhookSchema } from "../../schemas/webhook";
import { ErrorSchema, apiError } from "../../schemas/error";
import { createDb } from "../../db";
import { webhookRegistrations } from "../../db/schema";
import { generateWebhookId } from "../../lib/id";
import { eq, and } from "drizzle-orm";

const app = new OpenAPIHono<Env>();

// ---------- POST /v1/webhooks ----------
const createWebhookRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Webhooks"],
  summary: "Register a webhook",
  description: "Register a new webhook endpoint to receive event notifications.",
  security: [{ TenantApiKey: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: CreateWebhookSchema as any,
        },
      },
      required: true,
    },
  },
  responses: {
    201: {
      description: "Webhook created",
      content: {
        "application/json": { schema: WebhookSchema as any },
      },
    },
    400: {
      description: "Invalid request",
      content: { "application/json": { schema: ErrorSchema as any } },
    },
  },
});

app.openapi(createWebhookRoute, async (c) => {
  const tenantId = c.get("tenantId")!;
  const body = c.req.valid("json");

  const webhookId = generateWebhookId();
  const db = createDb(c.env.DB);

  await db.insert(webhookRegistrations).values({
    id: webhookId,
    tenantId,
    url: body.url,
    events: JSON.stringify(body.events),
    secret: body.secret || null,
    createdAt: Date.now(),
  });

  return c.json(
    {
      webhook_id: webhookId,
      url: body.url,
      events: body.events,
    },
    201
  );
});

// ---------- GET /v1/webhooks ----------
const listWebhooksRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Webhooks"],
  summary: "List webhooks",
  description: "List all registered webhooks for the authenticated tenant.",
  security: [{ TenantApiKey: [] }],
  responses: {
    200: {
      description: "List of webhooks",
      content: {
        "application/json": {
          schema: z.object({
            webhooks: z.array(WebhookSchema as any),
          }),
        },
      },
    },
  },
});

app.openapi(listWebhooksRoute, async (c): Promise<any> => {
  const tenantId = c.get("tenantId")!;
  const db = createDb(c.env.DB);

  const rows = await db
    .select()
    .from(webhookRegistrations)
    .where(eq(webhookRegistrations.tenantId, tenantId));

  return c.json({
    webhooks: rows.map((r) => ({
      webhook_id: r.id,
      url: r.url,
      events: JSON.parse(r.events),
      created_at: new Date(r.createdAt).toISOString(),
    })),
  });
});

// ---------- DELETE /v1/webhooks/:id ----------
const deleteWebhookRoute = createRoute({
  method: "delete",
  path: "/{id}",
  tags: ["Webhooks"],
  summary: "Delete a webhook",
  description: "Unregister a webhook endpoint.",
  security: [{ TenantApiKey: [] }],
  request: {
    params: z.object({
      id: z.string().openapi({
        param: { name: "id", in: "path" },
        description: "Webhook ID",
      }),
    }),
  },
  responses: {
    204: {
      description: "Webhook deleted",
    },
    404: {
      description: "Webhook not found",
      content: { "application/json": { schema: ErrorSchema as any } },
    },
  },
});

app.openapi(deleteWebhookRoute, async (c) => {
  const { id: webhookId } = c.req.valid("param");
  const tenantId = c.get("tenantId")!;
  const db = createDb(c.env.DB);

  const rows = await db
    .select()
    .from(webhookRegistrations)
    .where(and(eq(webhookRegistrations.id, webhookId), eq(webhookRegistrations.tenantId, tenantId)))
    .limit(1);

  if (rows.length === 0) {
    return c.json(apiError("sandbox_not_found", "Webhook not found"), 404);
  }

  await db.delete(webhookRegistrations).where(eq(webhookRegistrations.id, webhookId));
  return c.body(null, 204);
});

export default app;
