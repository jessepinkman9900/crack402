import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { Env } from "../../types";
import { ExecRequestSchema, ExecResultSchema } from "../../schemas/exec";
import { ErrorSchema, apiError } from "../../schemas/error";
import { createDb } from "../../db";
import { sandboxes, executions } from "../../db/schema";
import { generateExecId } from "../../lib/id";
import { eq, and } from "drizzle-orm";

const app = new OpenAPIHono<Env>();

const sandboxIdParam = z.object({
  sandboxId: z.string().openapi({
    param: { name: "sandboxId", in: "path" },
    description: "Sandbox ID",
  }),
});

// ---------- POST /v1/sandboxes/:sandboxId/exec ----------
const execRoute = createRoute({
  method: "post",
  path: "/{sandboxId}/exec",
  tags: ["Sandboxes"],
  summary: "Execute code or command",
  description: "Execute code, a command, or a file inside a sandbox.",
  security: [{ TenantApiKey: [] }],
  request: {
    params: sandboxIdParam,
    body: {
      content: {
        "application/json": {
          schema: ExecRequestSchema as any,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Execution completed (synchronous mode)",
      content: {
        "application/json": { schema: ExecResultSchema as any },
      },
    },
    202: {
      description: "Execution started (async mode)",
      content: {
        "application/json": {
          schema: z.object({
            exec_id: z.string(),
            status: z.string(),
            poll_url: z.string(),
            stream_url: z.string(),
          }),
        },
      },
    },
    404: {
      description: "Sandbox not found",
      content: { "application/json": { schema: ErrorSchema as any } },
    },
    408: {
      description: "Execution timed out",
      content: {
        "application/json": { schema: ExecResultSchema as any },
      },
    },
    409: {
      description: "Sandbox state conflict",
      content: { "application/json": { schema: ErrorSchema as any } },
    },
  },
});

app.openapi(execRoute, async (c): Promise<any> => {
  const { sandboxId } = c.req.valid("param");
  const tenantId = c.get("tenantId")!;
  const req = c.req.valid("json");

  const db = createDb(c.env.DB);

  // Verify sandbox exists and is running
  const rows = await db
    .select()
    .from(sandboxes)
    .where(and(eq(sandboxes.id, sandboxId), eq(sandboxes.tenantId, tenantId)))
    .limit(1);

  if (rows.length === 0) {
    return c.json(apiError("sandbox_not_found", `Sandbox ${sandboxId} not found`), 404);
  }

  const sandbox = rows[0];
  if (sandbox.status !== "running" && sandbox.status !== "ready") {
    return c.json(
      apiError("sandbox_state_conflict", `Sandbox is ${sandbox.status}, must be running or ready`),
      409
    );
  }

  // Record exec activity (resets idle timer)
  const trackerId = c.env.SANDBOX_TRACKER.idFromName(sandboxId);
  const trackerStub = c.env.SANDBOX_TRACKER.get(trackerId);
  await trackerStub.fetch("http://do/exec-activity", { method: "POST" });

  // If sandbox is ready, transition to running
  if (sandbox.status === "ready") {
    await trackerStub.fetch("http://do/transition", {
      method: "POST",
      body: JSON.stringify({ event: "exec_started" }),
    });
    await db.update(sandboxes).set({ status: "running", startedAt: Date.now() }).where(eq(sandboxes.id, sandboxId));
  }

  // Create execution record
  const execId = generateExecId();
  const now = Date.now();
  await db.insert(executions).values({
    id: execId,
    sandboxId,
    tenantId,
    type: req.type,
    status: "running",
    startedAt: now,
  });

  // Enqueue exec command to node
  const nodeManagerId = c.env.NODE_MANAGER.idFromName(sandbox.nodeId!);
  const nodeManagerStub = c.env.NODE_MANAGER.get(nodeManagerId);
  await nodeManagerStub.fetch("http://do/enqueue", {
    method: "POST",
    body: JSON.stringify({
      type: "exec",
      sandboxId,
      payload: {
        exec_id: execId,
        type: req.type,
        code: req.code,
        language: req.language,
        command: req.command,
        file_path: req.file_path,
        args: req.args,
        working_dir: req.working_dir,
        env_vars: req.env_vars,
        timeout_seconds: req.timeout_seconds,
        stdin: req.stdin,
      },
    }),
  });

  if (req.async) {
    return c.json(
      {
        exec_id: execId,
        status: "running",
        poll_url: `/v1/sandboxes/${sandboxId}/exec/${execId}`,
        stream_url: `/v1/sandboxes/${sandboxId}/exec/${execId}/stream`,
      },
      202
    );
  }

  // Synchronous: poll until done (simplified — in production use DO notifications)
  const deadline = now + req.timeout_seconds * 1000;
  while (Date.now() < deadline) {
    const execRows = await db
      .select()
      .from(executions)
      .where(eq(executions.id, execId))
      .limit(1);

    if (execRows.length > 0 && execRows[0].status !== "running") {
      const exec = execRows[0];
      return c.json({
        exec_id: exec.id,
        status: exec.status,
        exit_code: exec.exitCode,
        stdout: exec.stdout || "",
        stderr: exec.stderr || "",
        duration_ms: exec.durationMs || 0,
        started_at: new Date(exec.startedAt).toISOString(),
        completed_at: exec.completedAt ? new Date(exec.completedAt).toISOString() : null,
      });
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  // Timeout
  await db.update(executions).set({ status: "timed_out", completedAt: Date.now() }).where(eq(executions.id, execId));
  return c.json(
    {
      exec_id: execId,
      status: "timed_out",
      exit_code: null,
      stdout: "",
      stderr: "",
      duration_ms: Date.now() - now,
      started_at: new Date(now).toISOString(),
      completed_at: new Date().toISOString(),
    },
    408
  );
});

// ---------- GET /v1/sandboxes/:sandboxId/exec/:execId ----------
const getExecRoute = createRoute({
  method: "get",
  path: "/{sandboxId}/exec/{execId}",
  tags: ["Sandboxes"],
  summary: "Get execution result",
  description: "Retrieve the result of a previous execution.",
  security: [{ TenantApiKey: [] }],
  request: {
    params: z.object({
      sandboxId: z.string().openapi({
        param: { name: "sandboxId", in: "path" },
        description: "Sandbox ID",
      }),
      execId: z.string().openapi({
        param: { name: "execId", in: "path" },
        description: "Execution ID",
      }),
    }),
  },
  responses: {
    200: {
      description: "Execution result",
      content: {
        "application/json": { schema: ExecResultSchema as any },
      },
    },
    404: {
      description: "Execution not found",
      content: { "application/json": { schema: ErrorSchema as any } },
    },
  },
});

app.openapi(getExecRoute, async (c) => {
  const { execId } = c.req.valid("param");
  const tenantId = c.get("tenantId")!;

  const db = createDb(c.env.DB);
  const rows = await db
    .select()
    .from(executions)
    .where(and(eq(executions.id, execId), eq(executions.tenantId, tenantId)))
    .limit(1);

  if (rows.length === 0) {
    return c.json(apiError("sandbox_not_found", `Execution ${execId} not found`), 404);
  }

  const exec = rows[0];
  return c.json({
    exec_id: exec.id,
    status: exec.status,
    exit_code: exec.exitCode,
    stdout: exec.stdout || "",
    stderr: exec.stderr || "",
    duration_ms: exec.durationMs || 0,
    started_at: new Date(exec.startedAt).toISOString(),
    completed_at: exec.completedAt ? new Date(exec.completedAt).toISOString() : null,
  });
});

export default app;
