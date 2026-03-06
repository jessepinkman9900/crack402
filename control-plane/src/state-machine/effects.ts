import type { SandboxStatus } from "./sandbox-states";

export type WebhookEventType =
  | "sandbox.created"
  | "sandbox.ready"
  | "sandbox.started"
  | "sandbox.stopped"
  | "sandbox.paused"
  | "sandbox.destroyed"
  | "sandbox.error"
  | "sandbox.timeout"
  | "exec.started"
  | "exec.completed"
  | "exec.failed";

export interface Resources {
  vcpu: number;
  memoryMb: number;
  gpu?: string | null;
}

export type SideEffect =
  | {
      type: "enqueue_command";
      nodeId: string;
      command: {
        type: string;
        sandboxId: string;
        payload: Record<string, unknown>;
      };
    }
  | { type: "start_billing_meter"; sandboxId: string; ratePerSecondUsd: number }
  | { type: "stop_billing_meter"; sandboxId: string }
  | { type: "arm_ttl_timer"; sandboxId: string; durationMs: number }
  | { type: "arm_idle_timer"; sandboxId: string; durationMs: number }
  | { type: "cancel_timer"; sandboxId: string; timerType: "ttl" | "idle" }
  | {
      type: "emit_webhook";
      eventType: WebhookEventType;
      sandboxId: string;
      payload: Record<string, unknown>;
    }
  | {
      type: "write_d1";
      table: string;
      operation: "insert" | "update";
      record: Record<string, unknown>;
    }
  | {
      type: "update_scheduler";
      action: "allocate" | "release";
      sandboxId: string;
      nodeId: string;
      resources: Resources;
    }
  | { type: "update_quota"; tenantId: string; delta: number }
  | { type: "release_resources"; nodeId: string; resources: Resources }
  | { type: "notify_node_offline"; nodeId: string }
  | {
      type: "update_status";
      sandboxId: string;
      status: SandboxStatus;
      previousStatus: SandboxStatus;
    };
