import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { Env } from "../../types";
import { RegisterNodeSchema, IssueRegistrationTokenResponseSchema } from "../../schemas/node";
import { ErrorSchema, apiError } from "../../schemas/error";
import { createDb } from "../../db";
import { nodes } from "../../db/schema";
import { generateNodeId, generateApiKeyToken } from "../../lib/id";
import { eq } from "drizzle-orm";

const app = new OpenAPIHono<Env>();

// --- Route definitions ---

const nodeIdParam = z.object({
  nodeId: z.string().openapi({ param: { name: "nodeId", in: "path" }, description: "Node ID" }),
});

const issueRegistrationTokenRoute = createRoute({
  method: "post",
  path: "/registration-token",
  tags: ["Management (Nodes)"],
  summary: "Issue a node registration token",
  description: "Pre-register a node slot and return a short-lived registration token (10min). The node agent uses this token to self-register via PATCH /v1/internal/nodes/{nodeId}.",
  security: [{ OperatorApiKey: [] }],
  responses: {
    201: {
      description: "Registration token issued",
      content: { "application/json": { schema: IssueRegistrationTokenResponseSchema } },
    },
  },
});

const registerNodeRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Management (Nodes)"],
  summary: "Register a new node",
  description: "Register a new compute node in the fleet",
  security: [{ OperatorApiKey: [] }],
  request: {
    body: { content: { "application/json": { schema: RegisterNodeSchema } } },
  },
  responses: {
    201: {
      description: "Node registered",
      content: {
        "application/json": {
          schema: z.object({
            node_id: z.string(),
            bootstrap_token: z.string(),
            region: z.string(),
            status: z.string(),
          }),
        },
      },
    },
    400: {
      description: "Invalid node registration",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});

const listNodesRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Management (Nodes)"],
  summary: "List all nodes",
  description: "List all registered compute nodes",
  security: [{ OperatorApiKey: [] }],
  responses: {
    200: {
      description: "List of nodes",
      content: {
        "application/json": {
          schema: z.object({
            nodes: z.array(
              z.object({
                node_id: z.string(),
                status: z.string(),
                region: z.string(),
                total_vcpu: z.number(),
                total_memory_mb: z.number(),
                firecracker_version: z.string().nullable(),
                last_heartbeat_at: z.string().nullable(),
                created_at: z.string(),
              })
            ),
          }),
        },
      },
    },
  },
});

const getNodeRoute = createRoute({
  method: "get",
  path: "/{nodeId}",
  tags: ["Management (Nodes)"],
  summary: "Get node details",
  description: "Get details for a specific node",
  security: [{ OperatorApiKey: [] }],
  request: {
    params: nodeIdParam,
  },
  responses: {
    200: {
      description: "Node details",
      content: {
        "application/json": {
          schema: z.object({
            node_id: z.string(),
            status: z.string(),
            region: z.string(),
            total_vcpu: z.number(),
            total_memory_mb: z.number(),
            firecracker_version: z.string().nullable(),
            last_heartbeat_at: z.string().nullable(),
            created_at: z.string(),
          }),
        },
      },
    },
    404: {
      description: "Node not found",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});

const deleteNodeRoute = createRoute({
  method: "delete",
  path: "/{nodeId}",
  tags: ["Management (Nodes)"],
  summary: "Delete a node",
  description: "Unregister a node from the fleet",
  security: [{ OperatorApiKey: [] }],
  request: {
    params: nodeIdParam,
  },
  responses: {
    204: {
      description: "Node deleted",
    },
  },
});

const drainNodeRoute = createRoute({
  method: "post",
  path: "/{nodeId}/drain",
  tags: ["Management (Nodes)"],
  summary: "Drain a node",
  description: "Set a node to draining status to prevent new sandbox placement",
  security: [{ OperatorApiKey: [] }],
  request: {
    params: nodeIdParam,
  },
  responses: {
    200: {
      description: "Node draining",
      content: {
        "application/json": {
          schema: z.object({ node_id: z.string(), status: z.string() }),
        },
      },
    },
  },
});

const undrainNodeRoute = createRoute({
  method: "post",
  path: "/{nodeId}/undrain",
  tags: ["Management (Nodes)"],
  summary: "Undrain a node",
  description: "Restore a draining node to healthy status",
  security: [{ OperatorApiKey: [] }],
  request: {
    params: nodeIdParam,
  },
  responses: {
    200: {
      description: "Node healthy",
      content: {
        "application/json": {
          schema: z.object({ node_id: z.string(), status: z.string() }),
        },
      },
    },
  },
});

const cordonNodeRoute = createRoute({
  method: "post",
  path: "/{nodeId}/cordon",
  tags: ["Management (Nodes)"],
  summary: "Cordon a node",
  description: "Mark a node as cordoned",
  security: [{ OperatorApiKey: [] }],
  request: {
    params: nodeIdParam,
  },
  responses: {
    200: {
      description: "Node cordoned",
      content: {
        "application/json": {
          schema: z.object({ node_id: z.string(), status: z.string() }),
        },
      },
    },
  },
});

// --- Handlers ---

// POST /v1/mgmt/nodes/registration-token
app.openapi(issueRegistrationTokenRoute, async (c) => {
  const nodeId = generateNodeId();
  const registrationToken = generateApiKeyToken();
  const now = Date.now();
  const expiresAt = new Date(now + 10 * 60 * 1000).toISOString();
  const db = createDb(c.env.DB);

  await db.insert(nodes).values({
    id: nodeId,
    status: "pending",
    region: "unknown",
    totalVcpu: 0,
    totalMemoryMb: 0,
    bootstrapToken: registrationToken,
    createdAt: now,
  });

  await c.env.NODE_TOKENS.put(registrationToken, nodeId, { expirationTtl: 600 });

  return c.json(
    { node_id: nodeId, registration_token: registrationToken, expires_at: expiresAt },
    201
  );
});

// POST /v1/mgmt/nodes
app.openapi(registerNodeRoute, async (c) => {
  const body = c.req.valid("json");

  const nodeId = generateNodeId();
  const bootstrapToken = generateApiKeyToken();
  const now = Date.now();
  const db = createDb(c.env.DB);

  await db.insert(nodes).values({
    id: nodeId,
    status: "healthy",
    region: body.region,
    totalVcpu: body.total_vcpu,
    totalMemoryMb: body.total_memory_mb,
    firecrackerVersion: body.firecracker_version,
    bootstrapToken,
    metadata: body.metadata ? JSON.stringify(body.metadata) : null,
    createdAt: now,
  });

  // Store token -> nodeId mapping in KV for auth
  await c.env.NODE_TOKENS.put(bootstrapToken, nodeId);

  // Register in GlobalSchedulerDO
  const schedulerId = c.env.GLOBAL_SCHEDULER.idFromName("global");
  const schedulerStub = c.env.GLOBAL_SCHEDULER.get(schedulerId);
  await schedulerStub.fetch("http://do/update-node", {
    method: "POST",
    body: JSON.stringify({
      nodeId,
      totalVcpu: body.total_vcpu,
      usedVcpu: 0,
      totalMemoryMb: body.total_memory_mb,
      usedMemoryMb: 0,
      sandboxCount: 0,
      status: "healthy",
      region: body.region,
      lastHeartbeat: now,
    }),
  });

  return c.json(
    {
      node_id: nodeId,
      bootstrap_token: bootstrapToken,
      region: body.region,
      status: "healthy",
    },
    201
  );
});

// GET /v1/mgmt/nodes
app.openapi(listNodesRoute, async (c) => {
  const db = createDb(c.env.DB);
  const rows = await db.select().from(nodes);
  return c.json({
    nodes: rows.map((n) => ({
      node_id: n.id,
      status: n.status,
      region: n.region,
      total_vcpu: n.totalVcpu,
      total_memory_mb: n.totalMemoryMb,
      firecracker_version: n.firecrackerVersion,
      last_heartbeat_at: n.lastHeartbeatAt ? new Date(n.lastHeartbeatAt).toISOString() : null,
      created_at: new Date(n.createdAt).toISOString(),
    })),
  });
});

// GET /v1/mgmt/nodes/:nodeId
app.openapi(getNodeRoute, async (c) => {
  const { nodeId } = c.req.valid("param");
  const db = createDb(c.env.DB);
  const rows = await db.select().from(nodes).where(eq(nodes.id, nodeId)).limit(1);

  if (rows.length === 0) {
    return c.json(apiError("sandbox_not_found", `Node ${nodeId} not found`), 404) as any;
  }

  const n = rows[0];
  return c.json({
    node_id: n.id,
    status: n.status,
    region: n.region,
    total_vcpu: n.totalVcpu,
    total_memory_mb: n.totalMemoryMb,
    firecracker_version: n.firecrackerVersion,
    last_heartbeat_at: n.lastHeartbeatAt ? new Date(n.lastHeartbeatAt).toISOString() : null,
    created_at: new Date(n.createdAt).toISOString(),
  })  as any;
});

// DELETE /v1/mgmt/nodes/:nodeId
app.openapi(deleteNodeRoute, async (c) => {
  const { nodeId } = c.req.valid("param");
  const db = createDb(c.env.DB);

  await db.delete(nodes).where(eq(nodes.id, nodeId));

  // Remove from scheduler
  const schedulerId = c.env.GLOBAL_SCHEDULER.idFromName("global");
  const schedulerStub = c.env.GLOBAL_SCHEDULER.get(schedulerId);
  await schedulerStub.fetch("http://do/remove-node", {
    method: "POST",
    body: JSON.stringify({ nodeId }),
  });

  return c.body(null, 204);
});

// POST /v1/mgmt/nodes/:nodeId/drain
app.openapi(drainNodeRoute, async (c) => {
  const { nodeId } = c.req.valid("param");
  const db = createDb(c.env.DB);
  await db.update(nodes).set({ status: "draining" }).where(eq(nodes.id, nodeId));

  const schedulerId = c.env.GLOBAL_SCHEDULER.idFromName("global");
  const schedulerStub = c.env.GLOBAL_SCHEDULER.get(schedulerId);
  const nodeData = await schedulerStub.fetch("http://do/nodes").then((r) => r.json()) as { nodes: any[] };
  const node = nodeData.nodes.find((n: any) => n.nodeId === nodeId);
  if (node) {
    node.status = "draining";
    await schedulerStub.fetch("http://do/update-node", {
      method: "POST",
      body: JSON.stringify(node),
    });
  }

  return c.json({ node_id: nodeId, status: "draining" });
});

// POST /v1/mgmt/nodes/:nodeId/undrain
app.openapi(undrainNodeRoute, async (c) => {
  const { nodeId } = c.req.valid("param");
  const db = createDb(c.env.DB);
  await db.update(nodes).set({ status: "healthy" }).where(eq(nodes.id, nodeId));
  return c.json({ node_id: nodeId, status: "healthy" });
});

// POST /v1/mgmt/nodes/:nodeId/cordon
app.openapi(cordonNodeRoute, async (c) => {
  const { nodeId } = c.req.valid("param");
  const db = createDb(c.env.DB);
  await db.update(nodes).set({ status: "cordoned" }).where(eq(nodes.id, nodeId));
  return c.json({ node_id: nodeId, status: "cordoned" });
});

export default app;
