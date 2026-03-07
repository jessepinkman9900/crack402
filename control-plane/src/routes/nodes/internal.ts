import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { Env } from "../../types";
import { HeartbeatSchema, SandboxStateEventSchema, ExecEventSchema, CommandResultSchema, CommandSchema, NodeSelfRegisterSchema, NodeSelfRegisterResponseSchema, TokenRefreshResponseSchema } from "../../schemas/node";
import { ErrorSchema, apiError } from "../../schemas/error";
import { createDb } from "../../db";
import { sandboxes, executions, nodes } from "../../db/schema";
import { eq } from "drizzle-orm";
import { writeSandboxLifecyclePoint, writeBillingUsagePoint, writeExecResultPoint } from "../../lib/analytics";
import { generateApiKeyToken } from "../../lib/id";

const app = new OpenAPIHono<Env>();

// Separate unauthenticated app for self-registration (token validated from body)
const registerApp = new OpenAPIHono<Env>();

// --- Route definitions ---

const nodeIdParam = z.object({
  nodeId: z.string().openapi({ param: { name: "nodeId", in: "path" }, description: "Node ID" }),
});

const heartbeatRoute = createRoute({
  method: "post",
  path: "/{nodeId}/heartbeat",
  tags: ["Internal (Node)"],
  summary: "Node heartbeat",
  description: "Receive heartbeat from a node with resource usage information",
  security: [{ NodeToken: [] }],
  request: {
    params: nodeIdParam,
    body: { content: { "application/json": { schema: HeartbeatSchema } } },
  },
  responses: {
    200: {
      description: "Heartbeat accepted",
      content: { "application/json": { schema: z.object({ ok: z.boolean() }) } },
    },
    400: {
      description: "Invalid heartbeat payload",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});

const sandboxEventsRoute = createRoute({
  method: "post",
  path: "/{nodeId}/sandbox-events",
  tags: ["Internal (Node)"],
  summary: "Report sandbox state event",
  description: "Report a sandbox state change from a node",
  security: [{ NodeToken: [] }],
  request: {
    params: nodeIdParam,
    body: { content: { "application/json": { schema: SandboxStateEventSchema } } },
  },
  responses: {
    200: {
      description: "Event processed",
      content: { "application/json": { schema: z.object({ ok: z.boolean(), transitioned: z.boolean() }) } },
    },
    400: {
      description: "Invalid sandbox event",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});

const execEventsRoute = createRoute({
  method: "post",
  path: "/{nodeId}/exec-events",
  tags: ["Internal (Node)"],
  summary: "Report exec event",
  description: "Report an execution event from a node",
  security: [{ NodeToken: [] }],
  request: {
    params: nodeIdParam,
    body: { content: { "application/json": { schema: ExecEventSchema } } },
  },
  responses: {
    200: {
      description: "Exec event processed",
      content: { "application/json": { schema: z.object({ ok: z.boolean() }) } },
    },
    400: {
      description: "Invalid exec event",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});

const getCommandsRoute = createRoute({
  method: "get",
  path: "/{nodeId}/commands",
  tags: ["Internal (Node)"],
  summary: "Get pending commands",
  description: "Long-poll for pending commands for a node",
  security: [{ NodeToken: [] }],
  request: {
    params: nodeIdParam,
  },
  responses: {
    200: {
      description: "Pending commands",
      content: { "application/json": { schema: z.object({ commands: z.array(CommandSchema) }) } },
    },
  },
});

const ackCommandRoute = createRoute({
  method: "post",
  path: "/{nodeId}/commands/{cmdId}/ack",
  tags: ["Internal (Node)"],
  summary: "Acknowledge command",
  description: "Acknowledge receipt of a command",
  security: [{ NodeToken: [] }],
  request: {
    params: z.object({
      nodeId: z.string().openapi({ param: { name: "nodeId", in: "path" }, description: "Node ID" }),
      cmdId: z.string().openapi({ param: { name: "cmdId", in: "path" }, description: "Command ID" }),
    }),
  },
  responses: {
    200: {
      description: "Command acknowledged",
      content: { "application/json": { schema: z.object({ ok: z.boolean() }) } },
    },
  },
});

const commandResultRoute = createRoute({
  method: "post",
  path: "/{nodeId}/commands/{cmdId}/result",
  tags: ["Internal (Node)"],
  summary: "Report command result",
  description: "Report the result of a command execution",
  security: [{ NodeToken: [] }],
  request: {
    params: z.object({
      nodeId: z.string().openapi({ param: { name: "nodeId", in: "path" }, description: "Node ID" }),
      cmdId: z.string().openapi({ param: { name: "cmdId", in: "path" }, description: "Command ID" }),
    }),
    body: { content: { "application/json": { schema: CommandResultSchema } } },
  },
  responses: {
    200: {
      description: "Result recorded",
      content: { "application/json": { schema: z.object({ ok: z.boolean() }) } },
    },
  },
});

const selfRegisterRoute = createRoute({
  method: "patch",
  path: "/{nodeId}",
  tags: ["Internal (Node)"],
  summary: "Node self-registration",
  description: "Node agent completes registration by providing its own specs and the registration token from the body. Transitions the node from pending to healthy and issues an operational token.",
  security: [],
  request: {
    params: nodeIdParam,
    body: { content: { "application/json": { schema: NodeSelfRegisterSchema } } },
  },
  responses: {
    200: {
      description: "Node registered",
      content: { "application/json": { schema: NodeSelfRegisterResponseSchema } },
    },
    401: {
      description: "Missing or invalid registration token",
      content: { "application/json": { schema: ErrorSchema } },
    },
    403: {
      description: "Registration token does not match node ID or is expired",
      content: { "application/json": { schema: ErrorSchema } },
    },
    409: {
      description: "Node already registered",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});

const tokenRefreshRoute = createRoute({
  method: "post",
  path: "/{nodeId}/token/refresh",
  tags: ["Internal (Node)"],
  summary: "Rotate node token",
  description: "Issue a new operational token (15min TTL) and invalidate the old one. Call every ~10min.",
  security: [{ NodeToken: [] }],
  request: {
    params: nodeIdParam,
  },
  responses: {
    200: {
      description: "Token rotated",
      content: { "application/json": { schema: TokenRefreshResponseSchema } },
    },
    403: {
      description: "Token does not match node ID or is a human-operator session",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});

// --- Handlers ---

// POST /v1/internal/nodes/{nodeId}/heartbeat
app.openapi(heartbeatRoute, async (c) => {
  const { nodeId } = c.req.valid("param");
  const body = c.req.valid("json");

  // Forward to NodeManagerDO
  const doId = c.env.NODE_MANAGER.idFromName(nodeId);
  const stub = c.env.NODE_MANAGER.get(doId);
  await stub.fetch("http://do/heartbeat", {
    method: "POST",
    body: JSON.stringify(body),
  });

  // Update GlobalSchedulerDO with capacity metadata only.
  // Used resources (usedVcpu, usedMemoryMb, sandboxCount) are tracked exclusively
  // via sandbox create/delete operations — the scheduler merges and preserves those.
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
      status: body.status,
      region: "default",
      lastHeartbeat: Date.now(),
    }),
  });

  return c.json({ ok: true }) as any;
});

// POST /v1/internal/nodes/{nodeId}/sandbox-events
app.openapi(sandboxEventsRoute, async (c) => {
  const body = c.req.valid("json");
  const { nodeId } = c.req.valid("param");

  const { sandbox_id, status } = body;

  // Map node-reported status to state machine event
  const eventMap: Record<string, string> = {
    ready: "provision_complete",
    running: "start",
    paused: "pause",
    stopped: "stop_complete",
    error: "error_occurred",
    destroyed: "destroy",
  };

  const event = eventMap[status];
  if (!event) {
    return c.json(apiError("invalid_request", `Unknown sandbox status: ${status}`), 400);
  }

  // Pre-fetch sandbox for AE instrumentation (by PK — minimal latency)
  const db = createDb(c.env.DB);
  const sbxRows = await db
    .select()
    .from(sandboxes)
    .where(eq(sandboxes.id, sandbox_id))
    .limit(1);
  const sbx = sbxRows[0];

  // Transition via SandboxTrackerDO
  const trackerId = c.env.SANDBOX_TRACKER.idFromName(sandbox_id);
  const trackerStub = c.env.SANDBOX_TRACKER.get(trackerId);
  const res = await trackerStub.fetch("http://do/transition", {
    method: "POST",
    body: JSON.stringify({ event }),
  });

  // Update D1
  const now = Date.now();
  const updates: Record<string, unknown> = { status };
  if (status === "running") updates.startedAt = now;
  if (status === "destroyed") updates.destroyedAt = now;

  await db.update(sandboxes).set(updates as any).where(eq(sandboxes.id, sandbox_id));

  // Write Analytics Engine data points (fire-and-forget)
  if (sbx) {
    writeSandboxLifecyclePoint(c.env.AE_SANDBOX_LIFECYCLE, {
      tenantId: sbx.tenantId,
      sandboxId: sbx.id,
      fromStatus: sbx.status,
      toStatus: status,
      event,
      baseImage: sbx.baseImage,
      nodeId: nodeId,
      region: sbx.region ?? "",
      networkPolicy: sbx.networkPolicy,
      vcpu: sbx.vcpu,
      memoryMb: sbx.memoryMb,
      durationMs: 0,
    });

    // On terminal states, also write billing usage point
    if (status === "destroyed" || status === "stopped") {
      const uptimeMs = sbx.startedAt ? now - sbx.startedAt : 0;
      writeBillingUsagePoint(c.env.AE_BILLING_USAGE, {
        tenantId: sbx.tenantId,
        sandboxId: sbx.id,
        finalStatus: status,
        region: sbx.region ?? "",
        baseImage: sbx.baseImage,
        nodeId: nodeId,
        vcpu: sbx.vcpu,
        memoryMb: sbx.memoryMb,
        uptimeMs,
        costMicroUsd: sbx.costAccruedUsd ?? 0,
      });
    }
  }

  return c.json({ ok: true, transitioned: res.ok }) as any;
});

// POST /v1/internal/nodes/{nodeId}/exec-events
app.openapi(execEventsRoute, async (c) => {
  const body = c.req.valid("json");
  const { nodeId } = c.req.valid("param");

  const { exec_id, sandbox_id, status, exit_code, stdout, stderr, duration_ms } = body;

  // Pre-fetch execution record for AE instrumentation (by PK — minimal latency)
  const db = createDb(c.env.DB);
  const terminalStatuses = new Set(["completed", "failed", "timed_out"]);
  const execRows = terminalStatuses.has(status)
    ? await db.select().from(executions).where(eq(executions.id, exec_id)).limit(1)
    : [];
  const exec = execRows[0];

  // Update execution record in D1
  await db
    .update(executions)
    .set({
      status,
      exitCode: exit_code ?? null,
      stdout: stdout || null,
      stderr: stderr || null,
      durationMs: duration_ms || null,
      completedAt: status !== "running" ? Date.now() : null,
    })
    .where(eq(executions.id, exec_id));

  // Record exec activity on sandbox tracker (resets idle timer)
  if (status === "running") {
    const trackerId = c.env.SANDBOX_TRACKER.idFromName(sandbox_id);
    const trackerStub = c.env.SANDBOX_TRACKER.get(trackerId);
    await trackerStub.fetch("http://do/exec-activity", { method: "POST" });
  }

  // Write Analytics Engine data point on terminal statuses (fire-and-forget)
  if (exec && terminalStatuses.has(status)) {
    writeExecResultPoint(c.env.AE_EXEC_RESULTS, {
      tenantId: exec.tenantId,
      execId: exec_id,
      sandboxId: sandbox_id,
      execType: exec.type,
      status,
      nodeId,
      durationMs: duration_ms ?? 0,
      exitCode: exit_code ?? -1,
      stdoutBytes: stdout ? stdout.length : 0,
      stderrBytes: stderr ? stderr.length : 0,
    });
  }

  return c.json({ ok: true }) as any;
});

// GET /v1/internal/nodes/{nodeId}/commands
app.openapi(getCommandsRoute, async (c) => {
  const { nodeId } = c.req.valid("param");

  const doId = c.env.NODE_MANAGER.idFromName(nodeId);
  const stub = c.env.NODE_MANAGER.get(doId);
  const res = await stub.fetch("http://do/commands");
  const data = await res.json() as any;

  return c.json(data) as any;
});

// POST /v1/internal/nodes/{nodeId}/commands/{cmdId}/ack
app.openapi(ackCommandRoute, async (c) => {
  const { nodeId, cmdId } = c.req.valid("param");

  const doId = c.env.NODE_MANAGER.idFromName(nodeId);
  const stub = c.env.NODE_MANAGER.get(doId);
  await stub.fetch(`http://do/commands/${cmdId}/ack`, { method: "POST" });

  return c.json({ ok: true });
});

// POST /v1/internal/nodes/{nodeId}/commands/{cmdId}/result
app.openapi(commandResultRoute, async (c) => {
  const { nodeId, cmdId } = c.req.valid("param");
  const body = c.req.valid("json");

  const doId = c.env.NODE_MANAGER.idFromName(nodeId);
  const stub = c.env.NODE_MANAGER.get(doId);
  await stub.fetch(`http://do/commands/${cmdId}/result`, {
    method: "POST",
    body: JSON.stringify(body),
  });

  return c.json({ ok: true });
});

// PATCH /v1/internal/nodes/{nodeId}
registerApp.openapi(selfRegisterRoute, async (c) => {
  const { nodeId } = c.req.valid("param");
  const body = c.req.valid("json");

  const db = createDb(c.env.DB);
  const rows = await db.select().from(nodes).where(eq(nodes.id, nodeId)).limit(1);

  if (rows.length === 0) {
    return c.json(apiError("not_found", `Node ${nodeId} not found`), 404) as any;
  }

  const node = rows[0];

  if (node.status !== "pending") {
    return c.json(apiError("conflict", "Node is already registered"), 409) as any;
  }

  // Validate registration token from body against the stored bootstrap token
  if (c.env.DISABLE_AUTH !== "true") {
    if (!node.bootstrapToken || body.registration_token !== node.bootstrapToken) {
      return c.json(apiError("forbidden", "Invalid registration token"), 403) as any;
    }
    // Check KV to ensure the token hasn't expired
    const kvNodeId = await c.env.NODE_TOKENS.get(body.registration_token);
    if (!kvNodeId) {
      return c.json(apiError("forbidden", "Registration token has expired"), 403) as any;
    }
  }

  const now = Date.now();
  const operationalToken = generateApiKeyToken();
  const expiresAt = new Date(now + 15 * 60 * 1000).toISOString();

  // Update D1: set specs, transition to healthy
  await db.update(nodes).set({
    status: "healthy",
    region: body.region,
    totalVcpu: body.vcpu,
    totalMemoryMb: body.memory_mb,
    firecrackerVersion: body.firecracker_version ?? null,
    metadata: body.metadata ? JSON.stringify(body.metadata) : null,
    lastHeartbeatAt: now,
  }).where(eq(nodes.id, nodeId));

  // Store new operational token, then delete registration token
  await c.env.NODE_TOKENS.put(operationalToken, nodeId, { expirationTtl: 900 });
  if (node.bootstrapToken) {
    await c.env.NODE_TOKENS.delete(node.bootstrapToken);
  }

  // Register with GlobalSchedulerDO
  const schedulerId = c.env.GLOBAL_SCHEDULER.idFromName("global");
  const schedulerStub = c.env.GLOBAL_SCHEDULER.get(schedulerId);
  await schedulerStub.fetch("http://do/update-node", {
    method: "POST",
    body: JSON.stringify({
      nodeId,
      totalVcpu: body.vcpu,
      usedVcpu: 0,
      totalMemoryMb: body.memory_mb,
      usedMemoryMb: 0,
      sandboxCount: 0,
      status: "healthy",
      region: body.region,
      lastHeartbeat: now,
    }),
  });

  return c.json({ node_id: nodeId, token: operationalToken, expires_at: expiresAt }) as any;
});

// POST /v1/internal/nodes/{nodeId}/token/refresh
app.openapi(tokenRefreshRoute, async (c) => {
  const { nodeId } = c.req.valid("param");

  // Validate token maps to this nodeId (also catches human-operator sessions)
  const tokenNodeId = c.get("nodeId");
  if (tokenNodeId !== nodeId) {
    return c.json(apiError("forbidden", "Token does not match node ID"), 403) as any;
  }

  const oldToken = c.req.header("Authorization")?.slice(7) ?? null;
  const newToken = generateApiKeyToken();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  // Store new token first, then delete old — avoids lockout if put fails
  await c.env.NODE_TOKENS.put(newToken, nodeId, { expirationTtl: 900 });
  if (oldToken) {
    await c.env.NODE_TOKENS.delete(oldToken);
  }

  return c.json({ token: newToken, expires_at: expiresAt }) as any;
});

export default app;
export { registerApp as nodeRegisterApp };
