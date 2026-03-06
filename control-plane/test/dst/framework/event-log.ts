export type EventKind =
  | "action"
  | "state_change"
  | "fault"
  | "timer_fired"
  | "invariant_check"
  | "node_event"
  | "sandbox_event";

export interface LogEntry {
  step: number;
  timestamp: number;
  kind: EventKind;
  actor: string;       // e.g., "scheduler", "node_node_abc", "sandbox_sbx_123", "tenant_ten_1"
  action: string;      // e.g., "place_sandbox", "heartbeat", "transition"
  details: Record<string, unknown>;
  error?: string;
}

/**
 * Records every action, state change, and fault for replay on failure.
 */
export class EventLog {
  private entries: LogEntry[] = [];
  private step = 0;

  log(entry: Omit<LogEntry, "step">): void {
    this.entries.push({ ...entry, step: this.step });
  }

  nextStep(): void {
    this.step++;
  }

  getCurrentStep(): number {
    return this.step;
  }

  getAll(): LogEntry[] {
    return [...this.entries];
  }

  /** Get entries for a specific actor */
  getForActor(actor: string): LogEntry[] {
    return this.entries.filter((e) => e.actor === actor);
  }

  /** Get entries of a specific kind */
  getByKind(kind: EventKind): LogEntry[] {
    return this.entries.filter((e) => e.kind === kind);
  }

  /** Get entries in a step range */
  getRange(fromStep: number, toStep: number): LogEntry[] {
    return this.entries.filter((e) => e.step >= fromStep && e.step <= toStep);
  }

  /** Format the log as a human-readable trace */
  formatTrace(lastN?: number): string {
    const entries = lastN ? this.entries.slice(-lastN) : this.entries;
    return entries
      .map((e) => {
        const err = e.error ? ` ERROR: ${e.error}` : "";
        const details = Object.entries(e.details)
          .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
          .join(" ");
        return `[step=${e.step} t=${e.timestamp}] ${e.kind} ${e.actor}.${e.action} ${details}${err}`;
      })
      .join("\n");
  }

  /** Clear the log */
  clear(): void {
    this.entries = [];
    this.step = 0;
  }
}
