import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { Env } from "../../types";
import { createDb } from "../../db";
import { auditLogs } from "../../db/schema";
import { eq, desc } from "drizzle-orm";

const app = new OpenAPIHono<Env>();

// --- Route definitions ---

const listAuditLogsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Observability"],
  summary: "List audit logs",
  description: "List audit logs for the authenticated tenant",
  security: [{ TenantApiKey: [] }],
  request: {
    query: z.object({
      limit: z.string().optional().openapi({ description: "Maximum number of audit logs to return", example: "100" }),
    }),
  },
  responses: {
    200: {
      description: "List of audit logs",
      content: {
        "application/json": {
          schema: z.object({
            audit_logs: z.array(
              z.object({
                id: z.string(),
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

// GET /v1/obs/audit
app.openapi(listAuditLogsRoute, async (c) => {
  const tenantId = c.get("tenantId")!;
  const query = c.req.valid("query");
  const limit = parseInt(query.limit || "100", 10);

  const db = createDb(c.env.DB);
  const rows = await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.tenantId, tenantId))
    .orderBy(desc(auditLogs.timestamp))
    .limit(limit);

  return c.json({
    audit_logs: rows.map((r) => ({
      id: r.id,
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
