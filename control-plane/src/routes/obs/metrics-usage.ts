import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { Env } from "../../types";
import { queryAnalyticsEngine, parseWindowToInterval } from "../../lib/analytics-query";

const app = new OpenAPIHono<Env>();

const windowEnum = ["1h", "6h", "24h", "7d", "30d"] as const;

const getUsageMetricsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Observability"],
  summary: "Get resource usage metrics",
  description: "Get compute resource usage and cost metrics from Analytics Engine.",
  security: [{ TenantApiKey: [] }],
  request: {
    query: z.object({
      window: z.enum(windowEnum).default("24h").openapi({
        description: "Time window for metrics aggregation",
        example: "24h",
      }),
    }),
  },
  responses: {
    200: {
      description: "Resource usage metrics",
      content: {
        "application/json": {
          schema: z.object({
            window: z.string(),
            sandbox_count: z.number(),
            total_vcpu_seconds: z.number(),
            total_memory_gb_seconds: z.number(),
            total_cost_usd: z.number(),
            avg_uptime_seconds: z.number(),
            by_image: z.array(
              z.object({
                base_image: z.string(),
                vcpu_seconds: z.number(),
                cost_usd: z.number(),
              })
            ),
          }),
        },
      },
    },
    503: {
      description: "Analytics Engine not configured",
      content: {
        "application/json": {
          schema: z.object({ error: z.string() }),
        },
      },
    },
  },
});

app.openapi(getUsageMetricsRoute, async (c) => {
  if (!c.env.CF_ACCOUNT_ID || !c.env.CF_AE_API_TOKEN) {
    return c.json({ error: "not_configured" }, 503) as any;
  }

  const tenantId = c.get("tenantId")!;
  const { window } = c.req.valid("query");
  const interval = parseWindowToInterval(window);

  const [aggResult, byImageResult] = await Promise.all([
    queryAnalyticsEngine(
      c.env.CF_ACCOUNT_ID,
      c.env.CF_AE_API_TOKEN,
      `SELECT
         count() AS sandbox_count,
         SUM(double4) AS total_vcpu_seconds,
         SUM(double5) AS total_memory_gb_seconds,
         SUM(double6) AS total_cost_micro_usd,
         avg(double3 / 1000) AS avg_uptime_seconds
       FROM billing_usage
       WHERE index1 = '${tenantId}'
         AND timestamp > now() - ${interval}`
    ),
    queryAnalyticsEngine(
      c.env.CF_ACCOUNT_ID,
      c.env.CF_AE_API_TOKEN,
      `SELECT blob4 AS base_image, SUM(double4) AS vcpu_seconds, SUM(double6) AS cost_micro_usd
       FROM billing_usage
       WHERE index1 = '${tenantId}'
         AND timestamp > now() - ${interval}
       GROUP BY blob4`
    ),
  ]);

  const agg = aggResult.data[0] ?? {};

  return c.json({
    window,
    sandbox_count: Number(agg.sandbox_count ?? 0),
    total_vcpu_seconds: Number(agg.total_vcpu_seconds ?? 0),
    total_memory_gb_seconds: Number(agg.total_memory_gb_seconds ?? 0),
    total_cost_usd: Number(agg.total_cost_micro_usd ?? 0) / 1_000_000,
    avg_uptime_seconds: Number(agg.avg_uptime_seconds ?? 0),
    by_image: byImageResult.data.map((r) => ({
      base_image: String(r.base_image ?? ""),
      vcpu_seconds: Number(r.vcpu_seconds ?? 0),
      cost_usd: Number(r.cost_micro_usd ?? 0) / 1_000_000,
    })),
  });
});

export default app;
