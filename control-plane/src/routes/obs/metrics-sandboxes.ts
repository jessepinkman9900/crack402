import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { Env } from "../../types";
import { queryAnalyticsEngine, parseWindowToInterval } from "../../lib/analytics-query";

const app = new OpenAPIHono<Env>();

const windowEnum = ["1h", "6h", "24h", "7d", "30d"] as const;

const getSandboxMetricsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Observability"],
  summary: "Get sandbox lifecycle metrics",
  description: "Get time-bucketed sandbox lifecycle metrics from Analytics Engine.",
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
      description: "Sandbox lifecycle metrics",
      content: {
        "application/json": {
          schema: z.object({
            window: z.string(),
            total_created: z.number(),
            total_destroyed: z.number(),
            total_errors: z.number(),
            by_status: z.array(z.object({ status: z.string(), count: z.number() })),
            by_image: z.array(z.object({ base_image: z.string(), count: z.number() })),
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

app.openapi(getSandboxMetricsRoute, async (c) => {
  if (!c.env.CF_ACCOUNT_ID || !c.env.CF_AE_API_TOKEN) {
    return c.json({ error: "not_configured" }, 503) as any;
  }

  const tenantId = c.get("tenantId")!;
  const { window } = c.req.valid("query");
  const interval = parseWindowToInterval(window);

  const [aggResult, byStatusResult, byImageResult] = await Promise.all([
    queryAnalyticsEngine(
      c.env.CF_ACCOUNT_ID,
      c.env.CF_AE_API_TOKEN,
      `SELECT
         countIf(blob4 = 'create') AS total_created,
         SUM(double5) AS total_destroyed,
         SUM(double4) AS total_errors
       FROM sandbox_lifecycle
       WHERE index1 = '${tenantId}'
         AND timestamp > now() - ${interval}`
    ),
    queryAnalyticsEngine(
      c.env.CF_ACCOUNT_ID,
      c.env.CF_AE_API_TOKEN,
      `SELECT blob3 AS to_status, count() AS count
       FROM sandbox_lifecycle
       WHERE index1 = '${tenantId}'
         AND timestamp > now() - ${interval}
       GROUP BY blob3`
    ),
    queryAnalyticsEngine(
      c.env.CF_ACCOUNT_ID,
      c.env.CF_AE_API_TOKEN,
      `SELECT blob5 AS base_image, count() AS count
       FROM sandbox_lifecycle
       WHERE index1 = '${tenantId}'
         AND blob4 = 'create'
         AND timestamp > now() - ${interval}
       GROUP BY blob5`
    ),
  ]);

  const agg = aggResult.data[0] ?? {};

  return c.json({
    window,
    total_created: Number(agg.total_created ?? 0),
    total_destroyed: Number(agg.total_destroyed ?? 0),
    total_errors: Number(agg.total_errors ?? 0),
    by_status: byStatusResult.data.map((r) => ({
      status: String(r.to_status ?? ""),
      count: Number(r.count ?? 0),
    })),
    by_image: byImageResult.data.map((r) => ({
      base_image: String(r.base_image ?? ""),
      count: Number(r.count ?? 0),
    })),
  });
});

export default app;
