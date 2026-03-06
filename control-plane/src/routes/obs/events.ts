import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { Env } from "../../types";
import { createDb } from "../../db";
import { auditLogs } from "../../db/schema";
import { eq, desc } from "drizzle-orm";

const app = new OpenAPIHono<Env>();

// --- Route definitions ---

const listEventsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Observability"],
  summary: "List events",
  description: "List audit events for the authenticated tenant",
  security: [{ TenantApiKey: [] }],
  request: {
    query: z.object({
      limit: z.string().optional().openapi({ description: "Maximum number of events to return", example: "50" }),
    }),
  },
  responses: {
    200: {
      description: "List of events",
      content: {
        "application/json": {
          schema: z.object({
            events: z.array(
              z.object({
                event_id: z.string(),
                action: z.string(),
                resource_type: z.string(),
                resource_id: z.string().nullable(),
                request_id: z.string().nullable(),
                timestamp: z.string(),
                details: z.any().optional(),
              })
            ),
          }),
        },
      },
    },
  },
});

// --- Handlers ---

// GET /v1/obs/events
app.openapi(listEventsRoute, async (c) => {
  const tenantId = c.get("tenantId")!;
  const query = c.req.valid("query");
  const limit = parseInt(query.limit || "50", 10);

  const db = createDb(c.env.DB);
  const rows = await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.tenantId, tenantId))
    .orderBy(desc(auditLogs.timestamp))
    .limit(limit);

  return c.json({
    events: rows.map((r) => ({
      event_id: r.id,
      action: r.action,
      resource_type: r.resourceType,
      resource_id: r.resourceId,
      request_id: r.requestId,
      timestamp: new Date(r.timestamp).toISOString(),
      details: r.details ? JSON.parse(r.details) : undefined,
    })),
  }) as any;
});

export default app;
