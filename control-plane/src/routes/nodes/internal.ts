import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { Env } from "../../types";
import { HeartbeatSchema, SandboxStateEventSchema, ExecEventSchema, CommandResultSchema, CommandSchema } from "../../schemas/node";
import { ErrorSchema, apiError } from "../../schemas/error";
import { createDb } from "../../db";
import { sandboxes, executions } from "../../db/schema";
import { eq } from "drizzle-orm";

const app = new OpenAPIHono<Env>();

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

  // Update GlobalSchedulerDO with capacity info
  const schedulerId = c.env.GLOBAL_SCHEDULER.idFromName("global");
  const schedulerStub = c.env.GLOBAL_SCHEDULER.get(schedulerId);
  await schedulerStub.fetch("http://do/update-node", {
    method: "POST",
    body: JSON.stringify({
      nodeId,
      totalVcpu: body.total_vcpu,
      usedVcpu: body.used_vcpu,
      totalMemoryMb: body.total_memory_mb,
      usedMemoryMb: body.used_memory_mb,
      sandboxCount: body.sandbox_count,
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

  // Transition via SandboxTrackerDO
  const trackerId = c.env.SANDBOX_TRACKER.idFromName(sandbox_id);
  const trackerStub = c.env.SANDBOX_TRACKER.get(trackerId);
  const res = await trackerStub.fetch("http://do/transition", {
    method: "POST",
    body: JSON.stringify({ event }),
  });

  // Update D1
  const db = createDb(c.env.DB);
  const updates: Record<string, unknown> = { status };
  if (status === "running") updates.startedAt = Date.now();
  if (status === "destroyed") updates.destroyedAt = Date.now();

  await db.update(sandboxes).set(updates as any).where(eq(sandboxes.id, sandbox_id));

  return c.json({ ok: true, transitioned: res.ok }) as any;
});

// POST /v1/internal/nodes/{nodeId}/exec-events
app.openapi(execEventsRoute, async (c) => {
  const body = c.req.valid("json");

  const { exec_id, sandbox_id, status, exit_code, stdout, stderr, duration_ms } = body;

  // Update execution record in D1
  const db = createDb(c.env.DB);
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

export default app;
