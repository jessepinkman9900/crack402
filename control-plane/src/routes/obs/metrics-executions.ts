import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { Env } from "../../types";
import { queryAnalyticsEngine, parseWindowToInterval } from "../../lib/analytics-query";

const app = new OpenAPIHono<Env>();

const windowEnum = ["1h", "6h", "24h", "7d", "30d"] as const;

const getExecMetricsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Observability"],
  summary: "Get execution metrics",
  description: "Get execution metrics from Analytics Engine.",
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
      description: "Execution metrics",
      content: {
        "application/json": {
          schema: z.object({
            window: z.string(),
            total_executions: z.number(),
            success_count: z.number(),
            failure_count: z.number(),
            timeout_count: z.number(),
            success_rate: z.number(),
            avg_duration_ms: z.number(),
            p95_duration_ms: z.number(),
            by_type: z.array(
              z.object({
                exec_type: z.string(),
                count: z.number(),
                avg_duration_ms: z.number(),
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

app.openapi(getExecMetricsRoute, async (c) => {
  if (!c.env.CF_ACCOUNT_ID || !c.env.CF_AE_API_TOKEN) {
    return c.json({ error: "not_configured" }, 503) as any;
  }

  const tenantId = c.get("tenantId")!;
  const { window } = c.req.valid("query");
  const interval = parseWindowToInterval(window);

  const [aggResult, byTypeResult] = await Promise.all([
    queryAnalyticsEngine(
      c.env.CF_ACCOUNT_ID,
      c.env.CF_AE_API_TOKEN,
      `SELECT
         count() AS total_executions,
         SUM(double3) AS success_count,
         SUM(double4) AS failure_count,
         SUM(double5) AS timeout_count,
         avg(double1) AS avg_duration_ms,
         quantile(0.95)(double1) AS p95_duration_ms
       FROM exec_results
       WHERE index1 = '${tenantId}'
         AND timestamp > now() - ${interval}`
    ),
    queryAnalyticsEngine(
      c.env.CF_ACCOUNT_ID,
      c.env.CF_AE_API_TOKEN,
      `SELECT blob3 AS exec_type, count() AS count, avg(double1) AS avg_duration_ms
       FROM exec_results
       WHERE index1 = '${tenantId}'
         AND timestamp > now() - ${interval}
       GROUP BY blob3`
    ),
  ]);

  const agg = aggResult.data[0] ?? {};
  const total = Number(agg.total_executions ?? 0);
  const successCount = Number(agg.success_count ?? 0);

  return c.json({
    window,
    total_executions: total,
    success_count: successCount,
    failure_count: Number(agg.failure_count ?? 0),
    timeout_count: Number(agg.timeout_count ?? 0),
    success_rate: total > 0 ? successCount / total : 0,
    avg_duration_ms: Number(agg.avg_duration_ms ?? 0),
    p95_duration_ms: Number(agg.p95_duration_ms ?? 0),
    by_type: byTypeResult.data.map((r) => ({
      exec_type: String(r.exec_type ?? ""),
      count: Number(r.count ?? 0),
      avg_duration_ms: Number(r.avg_duration_ms ?? 0),
    })),
  });
});

export default app;
