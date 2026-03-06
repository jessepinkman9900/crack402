import type { DOStorage } from "../../src/durable-objects/base";

/**
 * In-memory implementation of DOStorage for unit testing.
 * Used by both unit tests and DST framework.
 */
export class InMemoryDOStorage implements DOStorage {
  private data: Map<string, unknown> = new Map();
  private alarm: number | null = null;
  public alarmCallback: (() => Promise<void>) | null = null;

  async get<T>(key: string): Promise<T | undefined> {
    const val = this.data.get(key);
    // Deep clone to prevent mutation
    return val !== undefined ? JSON.parse(JSON.stringify(val)) as T : undefined;
  }

  async getMultiple<T>(keys: string[]): Promise<Map<string, T>> {
    const result = new Map<string, T>();
    for (const key of keys) {
      const val = await this.get<T>(key);
      if (val !== undefined) result.set(key, val);
    }
    return result;
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.data.set(key, JSON.parse(JSON.stringify(value)));
  }

  async putMultiple(entries: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(entries)) {
      await this.put(key, value);
    }
  }

  async delete(key: string): Promise<boolean> {
    return this.data.delete(key);
  }

  async deleteMultiple(keys: string[]): Promise<number> {
    let count = 0;
    for (const key of keys) {
      if (this.data.delete(key)) count++;
    }
    return count;
  }

  async list<T>(options?: { prefix?: string; limit?: number }): Promise<Map<string, T>> {
    const result = new Map<string, T>();
    for (const [key, value] of this.data) {
      if (options?.prefix && !key.startsWith(options.prefix)) continue;
      result.set(key, JSON.parse(JSON.stringify(value)) as T);
      if (options?.limit && result.size >= options.limit) break;
    }
    return result;
  }

  async setAlarm(scheduledTime: number | Date): Promise<void> {
    this.alarm = scheduledTime instanceof Date ? scheduledTime.getTime() : scheduledTime;
  }

  async getAlarm(): Promise<number | null> {
    return this.alarm;
  }

  async deleteAlarm(): Promise<void> {
    this.alarm = null;
  }

  // Test helpers
  snapshot(): Map<string, unknown> {
    return new Map(this.data);
  }

  getAlarmTime(): number | null {
    return this.alarm;
  }

  clear(): void {
    this.data.clear();
    this.alarm = null;
  }
}
