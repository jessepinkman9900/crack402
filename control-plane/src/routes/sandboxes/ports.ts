import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { Env } from "../../types";
import { ErrorSchema, apiError } from "../../schemas/error";
import { createDb } from "../../db";
import { sandboxes } from "../../db/schema";
import { eq, and } from "drizzle-orm";

const app = new OpenAPIHono<Env>();

// ---------- GET /v1/sandboxes/:sandboxId/ports ----------
const listPortsRoute = createRoute({
  method: "get",
  path: "/{sandboxId}/ports",
  tags: ["Sandboxes"],
  summary: "List exposed ports",
  description: "List all exposed ports for a sandbox.",
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
      description: "List of ports",
      content: {
        "application/json": {
          schema: z.object({
            ports: z.array(
              z.object({
                port: z.number().int(),
                protocol: z.string().optional(),
                public_url: z.string().optional(),
              })
            ),
          }),
        },
      },
    },
    404: {
      description: "Sandbox not found",
      content: { "application/json": { schema: ErrorSchema as any } },
    },
  },
});

app.openapi(listPortsRoute, async (c) => {
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

  // In production, query the node agent for exposed ports
  return c.json({ ports: [] });
});

export default app;
