import type { SandboxStatus, SandboxEvent } from "./sandbox-states";
import { VALID_TRANSITIONS } from "./sandbox-states";
import type { SideEffect, Resources, WebhookEventType } from "./effects";

export interface TransitionContext {
  sandboxId: string;
  tenantId: string;
  nodeId: string;
  resources: Resources;
  timeoutSeconds: number;
  idleTimeoutSeconds: number;
  autoPauseOnIdle: boolean;
  autoDestroy: boolean;
}

export interface TransitionResult {
  newState: SandboxStatus;
  effects: SideEffect[];
}

export interface TransitionError {
  error: string;
  currentState: SandboxStatus;
  event: SandboxEvent;
}

export function transition(
  currentState: SandboxStatus,
  event: SandboxEvent,
  context: TransitionContext
): TransitionResult | TransitionError {
  // Handle idle_timeout special case: if auto_pause_on_idle is false, destroy instead of pause
  let nextState = VALID_TRANSITIONS[currentState]?.[event];

  if (nextState === undefined) {
    return {
      error: `Invalid transition: ${currentState} + ${event}`,
      currentState,
      event,
    };
  }

  // Override idle_timeout behavior based on config
  if (event === "idle_timeout" && !context.autoPauseOnIdle) {
    nextState = "destroyed";
  }

  const effects = computeEffects(currentState, nextState, event, context);

  return { newState: nextState, effects };
}

export function isTransitionError(
  result: TransitionResult | TransitionError
): result is TransitionError {
  return "error" in result;
}

function computeEffects(
  from: SandboxStatus,
  to: SandboxStatus,
  event: SandboxEvent,
  ctx: TransitionContext
): SideEffect[] {
  const effects: SideEffect[] = [];

  // Always record the status update
  effects.push({
    type: "update_status",
    sandboxId: ctx.sandboxId,
    status: to,
    previousStatus: from,
  });

  // Write status change to D1
  effects.push({
    type: "write_d1",
    table: "sandboxes",
    operation: "update",
    record: {
      id: ctx.sandboxId,
      status: to,
      ...(to === "destroyed" ? { destroyedAt: Date.now() } : {}),
      ...(to === "running" ? { startedAt: Date.now() } : {}),
    },
  });

  // Billing meter management
  if (to === "running" && from !== "running") {
    effects.push({
      type: "start_billing_meter",
      sandboxId: ctx.sandboxId,
      ratePerSecondUsd: computeRate(ctx.resources),
    });
  }
  if (from === "running" && to !== "running") {
    effects.push({
      type: "stop_billing_meter",
      sandboxId: ctx.sandboxId,
    });
  }

  // Timer management
  if (to === "running") {
    // Arm idle timer when entering running state
    if (ctx.idleTimeoutSeconds > 0) {
      effects.push({
        type: "arm_idle_timer",
        sandboxId: ctx.sandboxId,
        durationMs: ctx.idleTimeoutSeconds * 1000,
      });
    }
  }

  if (to === "ready" && from === "provisioning") {
    // Arm TTL timer when sandbox becomes ready
    effects.push({
      type: "arm_ttl_timer",
      sandboxId: ctx.sandboxId,
      durationMs: ctx.timeoutSeconds * 1000,
    });
  }

  // Cancel timers on terminal/non-running states
  if (to === "destroyed" || to === "error" || to === "stopped" || to === "paused") {
    effects.push({
      type: "cancel_timer",
      sandboxId: ctx.sandboxId,
      timerType: "idle",
    });
  }

  if (to === "destroyed") {
    effects.push({
      type: "cancel_timer",
      sandboxId: ctx.sandboxId,
      timerType: "ttl",
    });
  }

  // Resource management
  if (to === "destroyed") {
    effects.push({
      type: "update_scheduler",
      action: "release",
      sandboxId: ctx.sandboxId,
      nodeId: ctx.nodeId,
      resources: ctx.resources,
    });
    effects.push({
      type: "update_quota",
      tenantId: ctx.tenantId,
      delta: -1,
    });
    // Command to destroy on node
    if (from !== "provisioning" && from !== "error") {
      effects.push({
        type: "enqueue_command",
        nodeId: ctx.nodeId,
        command: {
          type: "destroy_sandbox",
          sandboxId: ctx.sandboxId,
          payload: {},
        },
      });
    }
  }

  // Pause/resume commands
  if (event === "pause") {
    effects.push({
      type: "enqueue_command",
      nodeId: ctx.nodeId,
      command: {
        type: "pause_sandbox",
        sandboxId: ctx.sandboxId,
        payload: {},
      },
    });
  }

  if (event === "resume") {
    effects.push({
      type: "enqueue_command",
      nodeId: ctx.nodeId,
      command: {
        type: "resume_sandbox",
        sandboxId: ctx.sandboxId,
        payload: {},
      },
    });
  }

  if (event === "stop_requested") {
    effects.push({
      type: "enqueue_command",
      nodeId: ctx.nodeId,
      command: {
        type: "destroy_sandbox",
        sandboxId: ctx.sandboxId,
        payload: { graceful: true },
      },
    });
  }

  // Webhook events
  const webhookEvent = mapToWebhookEvent(to, event);
  if (webhookEvent) {
    effects.push({
      type: "emit_webhook",
      eventType: webhookEvent,
      sandboxId: ctx.sandboxId,
      payload: { status: to, previous_status: from, event },
    });
  }

  return effects;
}

function mapToWebhookEvent(
  status: SandboxStatus,
  event: SandboxEvent
): WebhookEventType | null {
  switch (status) {
    case "ready":
      return "sandbox.ready";
    case "running":
      return "sandbox.started";
    case "stopped":
      return "sandbox.stopped";
    case "paused":
      return "sandbox.paused";
    case "destroyed":
      return event === "timeout" ? "sandbox.timeout" : "sandbox.destroyed";
    case "error":
      return "sandbox.error";
    default:
      return null;
  }
}

function computeRate(resources: Resources): number {
  // Simple pricing: $0.00001/sec per vCPU + $0.000001/sec per 256MB
  const vcpuRate = resources.vcpu * 0.00001;
  const memoryRate = (resources.memoryMb / 256) * 0.000001;
  return vcpuRate + memoryRate;
}
