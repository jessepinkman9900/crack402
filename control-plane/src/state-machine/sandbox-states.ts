export const SANDBOX_STATUSES = [
  "provisioning",
  "ready",
  "running",
  "paused",
  "stopping",
  "stopped",
  "error",
  "destroyed",
] as const;

export type SandboxStatus = (typeof SANDBOX_STATUSES)[number];

export const SANDBOX_EVENTS = [
  "provision_complete",
  "start",
  "exec_started",
  "pause",
  "resume",
  "stop_requested",
  "stop_complete",
  "destroy",
  "error_occurred",
  "timeout",
  "idle_timeout",
  "node_failure",
  "recover",
] as const;

export type SandboxEvent = (typeof SANDBOX_EVENTS)[number];

/**
 * Valid state transitions: from → event → to
 */
export const VALID_TRANSITIONS: Record<
  SandboxStatus,
  Partial<Record<SandboxEvent, SandboxStatus>>
> = {
  provisioning: {
    provision_complete: "ready",
    error_occurred: "error",
    destroy: "destroyed",
    node_failure: "error",
  },
  ready: {
    start: "running",
    exec_started: "running",
    destroy: "destroyed",
    error_occurred: "error",
    node_failure: "error",
  },
  running: {
    pause: "paused",
    stop_requested: "stopping",
    destroy: "destroyed",
    error_occurred: "error",
    timeout: "destroyed",
    idle_timeout: "paused", // overridden to "destroyed" when auto_pause_on_idle=false
    node_failure: "error",
  },
  paused: {
    resume: "running",
    stop_requested: "stopping",
    destroy: "destroyed",
    error_occurred: "error",
    node_failure: "error",
  },
  stopping: {
    stop_complete: "stopped",
    error_occurred: "error",
    destroy: "destroyed",
    node_failure: "error",
  },
  stopped: {
    start: "running",
    destroy: "destroyed",
    error_occurred: "error",
    node_failure: "error",
  },
  error: {
    destroy: "destroyed",
    recover: "ready",
  },
  destroyed: {
    // Terminal state — no transitions out
  },
};

export function isTerminal(status: SandboxStatus): boolean {
  return status === "destroyed";
}

export function isValidTransition(
  from: SandboxStatus,
  event: SandboxEvent
): boolean {
  return VALID_TRANSITIONS[from]?.[event] !== undefined;
}
