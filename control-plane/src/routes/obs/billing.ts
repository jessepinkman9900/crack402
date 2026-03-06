import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { Env } from "../../types";
import { createDb } from "../../db";
import { billingRecords } from "../../db/schema";
import { eq, desc } from "drizzle-orm";

const app = new OpenAPIHono<Env>();

// --- Route definitions ---

const getUsageRoute = createRoute({
  method: "get",
  path: "/usage",
  tags: ["Observability"],
  summary: "Get billing usage",
  description: "Get aggregated billing usage for the authenticated tenant",
  security: [{ TenantApiKey: [] }],
  responses: {
    200: {
      description: "Billing usage summary",
      content: {
        "application/json": {
          schema: z.object({
            tenant_id: z.string(),
            total_vcpu_seconds: z.number(),
            total_memory_gb_seconds: z.number(),
            total_cost_usd: z.number(),
            records_count: z.number(),
          }),
        },
      },
    },
  },
});

const getInvoicesRoute = createRoute({
  method: "get",
  path: "/invoices",
  tags: ["Observability"],
  summary: "Get billing invoices",
  description: "Get billing invoice records for the authenticated tenant",
  security: [{ TenantApiKey: [] }],
  responses: {
    200: {
      description: "Billing invoices",
      content: {
        "application/json": {
          schema: z.object({
            invoices: z.array(
              z.object({
                id: z.string(),
                sandbox_id: z.string(),
                vcpu_seconds: z.number().nullable(),
                memory_gb_seconds: z.number().nullable(),
                cost_usd: z.number(),
                period_start: z.string(),
                period_end: z.string().nullable(),
              })
            ),
          }),
        },
      },
    },
  },
});

// --- Handlers ---

// GET /v1/obs/billing/usage
app.openapi(getUsageRoute, async (c) => {
  const tenantId = c.get("tenantId")!;
  const db = createDb(c.env.DB);

  const rows = await db
    .select()
    .from(billingRecords)
    .where(eq(billingRecords.tenantId, tenantId))
    .orderBy(desc(billingRecords.periodStart));

  const totalVcpuSeconds = rows.reduce((sum, r) => sum + (r.vcpuSeconds || 0), 0);
  const totalMemoryGbSeconds = rows.reduce((sum, r) => sum + (r.memoryGbSeconds || 0), 0);
  const totalCostUsd = rows.reduce((sum, r) => sum + (r.costMicroUsd || 0), 0) / 1_000_000;

  return c.json({
    tenant_id: tenantId,
    total_vcpu_seconds: totalVcpuSeconds,
    total_memory_gb_seconds: totalMemoryGbSeconds,
    total_cost_usd: totalCostUsd,
    records_count: rows.length,
  });
});

// GET /v1/obs/billing/invoices
app.openapi(getInvoicesRoute, async (c) => {
  const tenantId = c.get("tenantId")!;
  const db = createDb(c.env.DB);

  const rows = await db
    .select()
    .from(billingRecords)
    .where(eq(billingRecords.tenantId, tenantId))
    .orderBy(desc(billingRecords.periodStart));

  return c.json({
    invoices: rows.map((r) => ({
      id: r.id,
      sandbox_id: r.sandboxId,
      vcpu_seconds: r.vcpuSeconds,
      memory_gb_seconds: r.memoryGbSeconds,
      cost_usd: (r.costMicroUsd || 0) / 1_000_000,
      period_start: new Date(r.periodStart).toISOString(),
      period_end: r.periodEnd ? new Date(r.periodEnd).toISOString() : null,
    })),
  });
});

export default app;
