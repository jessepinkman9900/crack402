import type { Clock } from "../../../src/lib/clock";

export interface TimerEntry {
  id: string;
  fireAt: number;
  callback: () => Promise<void>;
}

/**
 * Controllable virtual clock for deterministic simulation.
 * Maintains a priority queue of timers that fire in order when time is advanced.
 */
export class VirtualClock implements Clock {
  private _now: number;
  private timers: TimerEntry[] = [];
  private nextTimerId = 0;

  constructor(startMs = 0) {
    this._now = startMs;
  }

  now(): number {
    return this._now;
  }

  isoNow(): string {
    return new Date(this._now).toISOString();
  }

  /** Schedule a timer to fire at a specific time */
  scheduleAt(fireAt: number, callback: () => Promise<void>): string {
    const id = `timer_${this.nextTimerId++}`;
    this.timers.push({ id, fireAt, callback });
    this.timers.sort((a, b) => a.fireAt - b.fireAt);
    return id;
  }

  /** Schedule a timer to fire after a delay */
  scheduleAfter(delayMs: number, callback: () => Promise<void>): string {
    return this.scheduleAt(this._now + delayMs, callback);
  }

  /** Cancel a timer by ID */
  cancelTimer(id: string): boolean {
    const idx = this.timers.findIndex((t) => t.id === id);
    if (idx === -1) return false;
    this.timers.splice(idx, 1);
    return true;
  }

  /** Cancel all timers */
  cancelAll(): void {
    this.timers = [];
  }

  /** Get the next timer's fire time, or null if no timers */
  nextTimerAt(): number | null {
    return this.timers.length > 0 ? this.timers[0].fireAt : null;
  }

  /** Get count of pending timers */
  get pendingTimerCount(): number {
    return this.timers.length;
  }

  /**
   * Advance time to `targetMs`, firing all timers whose fireAt <= targetMs
   * in chronological order. Returns the number of timers fired.
   */
  async advanceTo(targetMs: number): Promise<number> {
    if (targetMs < this._now) {
      throw new Error(`Cannot go backwards: current=${this._now}, target=${targetMs}`);
    }

    let fired = 0;
    while (this.timers.length > 0 && this.timers[0].fireAt <= targetMs) {
      const timer = this.timers.shift()!;
      this._now = timer.fireAt;
      await timer.callback();
      fired++;
    }
    this._now = targetMs;
    return fired;
  }

  /** Advance time by `deltaMs` */
  async advance(deltaMs: number): Promise<number> {
    return this.advanceTo(this._now + deltaMs);
  }

  /** Set time directly without firing timers */
  setNow(ms: number): void {
    this._now = ms;
  }
}
