import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { Env } from "../../types";

const app = new OpenAPIHono<Env>();

// --- Route definitions ---

const getMetricsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Observability"],
  summary: "Get fleet metrics",
  description: "Get fleet-wide metrics including node counts and vCPU utilization",
  security: [{ TenantApiKey: [] }],
  responses: {
    200: {
      description: "Fleet metrics",
      content: {
        "application/json": {
          schema: z.object({
            fleet: z.object({
              node_count: z.number(),
              vcpu_utilization: z.number(),
              nodes: z.array(
                z.object({
                  node_id: z.string(),
                  status: z.string(),
                  sandbox_count: z.number(),
                  vcpu_utilization: z.number(),
                })
              ),
            }),
          }),
        },
      },
    },
  },
});

// --- Handlers ---

// GET /v1/obs/fleet/metrics
app.openapi(getMetricsRoute, async (c) => {
  const schedulerId = c.env.GLOBAL_SCHEDULER.idFromName("global");
  const schedulerStub = c.env.GLOBAL_SCHEDULER.get(schedulerId);
  const res = await schedulerStub.fetch("http://do/nodes");
  const data = (await res.json()) as { nodes: any[] };

  const nodeList = data.nodes || [];
  const totalVcpu = nodeList.reduce((sum: number, n: any) => sum + (n.totalVcpu || 0), 0);
  const usedVcpu = nodeList.reduce((sum: number, n: any) => sum + (n.usedVcpu || 0), 0);

  return c.json({
    fleet: {
      node_count: nodeList.length,
      vcpu_utilization: totalVcpu > 0 ? usedVcpu / totalVcpu : 0,
      nodes: nodeList.map((n: any) => ({
        node_id: n.nodeId,
        status: n.status,
        sandbox_count: n.sandboxCount,
        vcpu_utilization: n.totalVcpu > 0 ? n.usedVcpu / n.totalVcpu : 0,
      })),
    },
  });
});

export default app;
