import type { DOStorage } from "../../../src/durable-objects/base";
import type { DeterministicRandom } from "./deterministic-random";

export interface StorageFaultConfig {
  readFailureRate: number;  // 0-1
  writeFailureRate: number; // 0-1
}

/**
 * In-memory DOStorage with optional fault injection.
 * Supports snapshots for invariant checking.
 */
export class DeterministicStorage implements DOStorage {
  private data: Map<string, unknown> = new Map();
  private alarm: number | null = null;
  private random: DeterministicRandom;
  private faultConfig: StorageFaultConfig;

  constructor(random: DeterministicRandom, faultConfig: StorageFaultConfig = { readFailureRate: 0, writeFailureRate: 0 }) {
    this.random = random;
    this.faultConfig = faultConfig;
  }

  private maybeFailRead(): void {
    if (this.faultConfig.readFailureRate > 0 && this.random.chance(this.faultConfig.readFailureRate)) {
      throw new Error("DST_FAULT: Storage read failure");
    }
  }

  private maybeFailWrite(): void {
    if (this.faultConfig.writeFailureRate > 0 && this.random.chance(this.faultConfig.writeFailureRate)) {
      throw new Error("DST_FAULT: Storage write failure");
    }
  }

  async get<T>(key: string): Promise<T | undefined> {
    this.maybeFailRead();
    const val = this.data.get(key);
    // Deep clone to prevent reference sharing
    return val !== undefined ? JSON.parse(JSON.stringify(val)) as T : undefined;
  }

  async getMultiple<T>(keys: string[]): Promise<Map<string, T>> {
    this.maybeFailRead();
    const result = new Map<string, T>();
    for (const key of keys) {
      const val = this.data.get(key);
      if (val !== undefined) {
        result.set(key, JSON.parse(JSON.stringify(val)) as T);
      }
    }
    return result;
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.maybeFailWrite();
    this.data.set(key, JSON.parse(JSON.stringify(value)));
  }

  async putMultiple(entries: Record<string, unknown>): Promise<void> {
    this.maybeFailWrite();
    for (const [key, value] of Object.entries(entries)) {
      this.data.set(key, JSON.parse(JSON.stringify(value)));
    }
  }

  async delete(key: string): Promise<boolean> {
    this.maybeFailWrite();
    return this.data.delete(key);
  }

  async deleteMultiple(keys: string[]): Promise<number> {
    this.maybeFailWrite();
    let count = 0;
    for (const key of keys) {
      if (this.data.delete(key)) count++;
    }
    return count;
  }

  async list<T>(options?: { prefix?: string; limit?: number }): Promise<Map<string, T>> {
    this.maybeFailRead();
    const result = new Map<string, T>();
    const entries = Array.from(this.data.entries())
      .filter(([key]) => !options?.prefix || key.startsWith(options.prefix))
      .sort(([a], [b]) => a.localeCompare(b));

    const limited = options?.limit ? entries.slice(0, options.limit) : entries;
    for (const [key, value] of limited) {
      result.set(key, JSON.parse(JSON.stringify(value)) as T);
    }
    return result;
  }

  async setAlarm(scheduledTime: number): Promise<void> {
    this.maybeFailWrite();
    this.alarm = scheduledTime;
  }

  async getAlarm(): Promise<number | null> {
    return this.alarm;
  }

  async deleteAlarm(): Promise<void> {
    this.alarm = null;
  }

  /** Take a snapshot of current state for invariant checking */
  snapshot(): Map<string, unknown> {
    const snap = new Map<string, unknown>();
    for (const [key, value] of this.data) {
      snap.set(key, JSON.parse(JSON.stringify(value)));
    }
    return snap;
  }

  /** Get all data (for inspection) */
  getAllData(): Map<string, unknown> {
    return new Map(this.data);
  }

  /** Get alarm time */
  getAlarmTime(): number | null {
    return this.alarm;
  }

  /** Reset all data */
  clear(): void {
    this.data.clear();
    this.alarm = null;
  }
}
