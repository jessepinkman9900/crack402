import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { Env } from "../../types";
import { createDb } from "../../db";
import { nodes } from "../../db/schema";

const app = new OpenAPIHono<Env>();

// --- Route definitions ---

const getFleetStatusRoute = createRoute({
  method: "get",
  path: "/status",
  tags: ["Management (Fleet)"],
  summary: "Get fleet status",
  description: "Get aggregated fleet status including node counts and resource utilization",
  security: [{ OperatorApiKey: [] }],
  responses: {
    200: {
      description: "Fleet status",
      content: {
        "application/json": {
          schema: z.object({
            node_count: z.number(),
            healthy_nodes: z.number(),
            total_vcpu: z.number(),
            used_vcpu: z.number(),
            total_memory_mb: z.number(),
            used_memory_mb: z.number(),
            total_sandboxes: z.number(),
          }),
        },
      },
    },
  },
});

const getSchedulerConfigRoute = createRoute({
  method: "get",
  path: "/scheduler-config",
  tags: ["Management (Fleet)"],
  summary: "Get scheduler configuration",
  description: "Get the current scheduler strategy configuration",
  security: [{ OperatorApiKey: [] }],
  responses: {
    200: {
      description: "Scheduler configuration",
      content: {
        "application/json": {
          schema: z.object({ strategy: z.string() }).passthrough(),
        },
      },
    },
  },
});

const updateSchedulerConfigRoute = createRoute({
  method: "put",
  path: "/scheduler-config",
  tags: ["Management (Fleet)"],
  summary: "Update scheduler configuration",
  description: "Update the scheduler strategy configuration",
  security: [{ OperatorApiKey: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({ strategy: z.string().optional() }).passthrough(),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Updated scheduler configuration",
      content: {
        "application/json": {
          schema: z.object({ strategy: z.string() }).passthrough(),
        },
      },
    },
  },
});

// --- Handlers ---

// GET /v1/mgmt/fleet/status
app.openapi(getFleetStatusRoute, async (c) => {
  const schedulerId = c.env.GLOBAL_SCHEDULER.idFromName("global");
  const schedulerStub = c.env.GLOBAL_SCHEDULER.get(schedulerId);
  const res = await schedulerStub.fetch("http://do/nodes");
  const data = (await res.json()) as { nodes: any[] };

  const nodeList = data.nodes || [];
  const totalVcpu = nodeList.reduce((sum: number, n: any) => sum + (n.totalVcpu || 0), 0);
  const usedVcpu = nodeList.reduce((sum: number, n: any) => sum + (n.usedVcpu || 0), 0);
  const totalMemoryMb = nodeList.reduce((sum: number, n: any) => sum + (n.totalMemoryMb || 0), 0);
  const usedMemoryMb = nodeList.reduce((sum: number, n: any) => sum + (n.usedMemoryMb || 0), 0);
  const totalSandboxes = nodeList.reduce((sum: number, n: any) => sum + (n.sandboxCount || 0), 0);

  return c.json({
    node_count: nodeList.length,
    healthy_nodes: nodeList.filter((n: any) => n.status === "healthy").length,
    total_vcpu: totalVcpu,
    used_vcpu: usedVcpu,
    total_memory_mb: totalMemoryMb,
    used_memory_mb: usedMemoryMb,
    total_sandboxes: totalSandboxes,
  }) as any;
});

// GET /v1/mgmt/fleet/scheduler-config
app.openapi(getSchedulerConfigRoute, async (c) => {
  const schedulerId = c.env.GLOBAL_SCHEDULER.idFromName("global");
  const schedulerStub = c.env.GLOBAL_SCHEDULER.get(schedulerId);
  const res = await schedulerStub.fetch("http://do/strategy");
  return c.json(await res.json() as any) as any;
});

// PUT /v1/mgmt/fleet/scheduler-config
app.openapi(updateSchedulerConfigRoute, async (c) => {
  const body = c.req.valid("json");
  const schedulerId = c.env.GLOBAL_SCHEDULER.idFromName("global");
  const schedulerStub = c.env.GLOBAL_SCHEDULER.get(schedulerId);
  const res = await schedulerStub.fetch("http://do/strategy", {
    method: "PUT",
    body: JSON.stringify(body),
  });
  return c.json(await res.json() as any) as any;
});

export default app;
