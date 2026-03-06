import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { Env } from "../../types";
import { ErrorSchema, apiError } from "../../schemas/error";
import { createDb } from "../../db";
import { sandboxes } from "../../db/schema";
import { eq, and } from "drizzle-orm";

const app = new OpenAPIHono<Env>();

const sandboxIdParam = z.object({
  sandboxId: z.string().openapi({
    param: { name: "sandboxId", in: "path" },
    description: "Sandbox ID",
  }),
});

const sandboxStatusResponse = z.object({
  sandbox_id: z.string(),
  status: z.string(),
});

// ---------- GET /v1/sandboxes/:sandboxId/wait ----------
const waitRoute = createRoute({
  method: "get",
  path: "/{sandboxId}/wait",
  tags: ["Sandboxes"],
  summary: "Wait for sandbox state",
  description: "Long-poll until a sandbox reaches the desired state.",
  security: [{ TenantApiKey: [] }],
  request: {
    params: sandboxIdParam,
    query: z.object({
      state: z.string().openapi({ description: "Target state to wait for" }),
      timeout_seconds: z.string().optional().openapi({ description: "Max seconds to wait (default 60)", example: "60" }),
    }),
  },
  responses: {
    200: {
      description: "Sandbox reached desired state",
      content: {
        "application/json": { schema: sandboxStatusResponse },
      },
    },
    400: {
      description: "Missing state parameter",
      content: { "application/json": { schema: ErrorSchema as any } },
    },
    404: {
      description: "Sandbox not found",
      content: { "application/json": { schema: ErrorSchema as any } },
    },
    408: {
      description: "Timeout waiting for state",
      content: { "application/json": { schema: ErrorSchema as any } },
    },
  },
});

app.openapi(waitRoute, async (c) => {
  const { sandboxId } = c.req.valid("param");
  const query = c.req.valid("query");
  const targetState = query.state;
  const timeoutSec = parseInt(query.timeout_seconds || "60", 10);

  if (!targetState) {
    return c.json(apiError("invalid_request", "Missing 'state' query parameter"), 400);
  }

  const tenantId = c.get("tenantId")!;
  const db = createDb(c.env.DB);
  const deadline = Date.now() + timeoutSec * 1000;

  // Poll loop — in production this would use DO state change notifications
  while (Date.now() < deadline) {
    const rows = await db
      .select()
      .from(sandboxes)
      .where(and(eq(sandboxes.id, sandboxId), eq(sandboxes.tenantId, tenantId)))
      .limit(1);

    if (rows.length === 0) {
      return c.json(apiError("sandbox_not_found", `Sandbox ${sandboxId} not found`), 404);
    }

    if (rows[0].status === targetState) {
      return c.json({
        sandbox_id: rows[0].id,
        status: rows[0].status,
      });
    }

    // Wait 1 second before polling again
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return c.json(apiError("exec_timeout", "Timeout waiting for state transition"), 408);
});

// ---------- POST /v1/sandboxes/:sandboxId/start ----------
const startRoute = createRoute({
  method: "post",
  path: "/{sandboxId}/start",
  tags: ["Sandboxes"],
  summary: "Start a sandbox",
  description: "Transition a sandbox to the running state.",
  security: [{ TenantApiKey: [] }],
  request: {
    params: sandboxIdParam,
  },
  responses: {
    200: {
      description: "Sandbox started",
      content: {
        "application/json": { schema: sandboxStatusResponse },
      },
    },
    404: {
      description: "Sandbox not found",
      content: { "application/json": { schema: ErrorSchema as any } },
    },
    409: {
      description: "Sandbox state conflict",
      content: { "application/json": { schema: ErrorSchema as any } },
    },
  },
});

app.openapi(startRoute, async (c) => {
  const { sandboxId } = c.req.valid("param");
  return transitionSandbox(c as any, sandboxId, "start") as any;
});

// ---------- POST /v1/sandboxes/:sandboxId/stop ----------
const stopRoute = createRoute({
  method: "post",
  path: "/{sandboxId}/stop",
  tags: ["Sandboxes"],
  summary: "Stop a sandbox",
  description: "Gracefully stop a running sandbox.",
  security: [{ TenantApiKey: [] }],
  request: {
    params: sandboxIdParam,
  },
  responses: {
    200: {
      description: "Sandbox stopped",
      content: {
        "application/json": { schema: sandboxStatusResponse },
      },
    },
    404: {
      description: "Sandbox not found",
      content: { "application/json": { schema: ErrorSchema as any } },
    },
    409: {
      description: "Sandbox state conflict",
      content: { "application/json": { schema: ErrorSchema as any } },
    },
  },
});

app.openapi(stopRoute, async (c) => {
  const { sandboxId } = c.req.valid("param");
  return transitionSandbox(c as any, sandboxId, "stop_requested") as any;
});

// ---------- POST /v1/sandboxes/:sandboxId/pause ----------
const pauseRoute = createRoute({
  method: "post",
  path: "/{sandboxId}/pause",
  tags: ["Sandboxes"],
  summary: "Pause a sandbox",
  description: "Pause a running sandbox to save resources.",
  security: [{ TenantApiKey: [] }],
  request: {
    params: sandboxIdParam,
  },
  responses: {
    200: {
      description: "Sandbox paused",
      content: {
        "application/json": { schema: sandboxStatusResponse },
      },
    },
    404: {
      description: "Sandbox not found",
      content: { "application/json": { schema: ErrorSchema as any } },
    },
    409: {
      description: "Sandbox state conflict",
      content: { "application/json": { schema: ErrorSchema as any } },
    },
  },
});

app.openapi(pauseRoute, async (c) => {
  const { sandboxId } = c.req.valid("param");
  return transitionSandbox(c as any, sandboxId, "pause") as any;
});

async function transitionSandbox(
  c: any,
  sandboxId: string,
  event: string
) {
  const tenantId = c.get("tenantId")!;

  // Verify ownership
  const db = createDb(c.env.DB);
  const rows = await db
    .select()
    .from(sandboxes)
    .where(and(eq(sandboxes.id, sandboxId), eq(sandboxes.tenantId, tenantId)))
    .limit(1);

  if (rows.length === 0) {
    return c.json(apiError("sandbox_not_found", `Sandbox ${sandboxId} not found`), 404);
  }

  // Transition via SandboxTrackerDO
  const trackerId = c.env.SANDBOX_TRACKER.idFromName(sandboxId);
  const trackerStub = c.env.SANDBOX_TRACKER.get(trackerId);
  const res = await trackerStub.fetch("http://do/transition", {
    method: "POST",
    body: JSON.stringify({ event }),
  });

  if (!res.ok) {
    const err = await res.json() as { error: string };
    return c.json(apiError("sandbox_state_conflict", err.error), 409);
  }

  const result = await res.json() as { newState: string };

  // Update D1
  await db
    .update(sandboxes)
    .set({ status: result.newState as any })
    .where(eq(sandboxes.id, sandboxId));

  return c.json({
    sandbox_id: sandboxId,
    status: result.newState,
  });
}

export default app;
