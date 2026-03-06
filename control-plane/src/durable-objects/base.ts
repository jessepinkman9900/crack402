/**
 * Abstraction over DurableObjectStorage for testability.
 * In production, wraps the real DurableObjectStorage.
 * In DST, replaced with DeterministicStorage.
 */
export interface DOStorage {
  get<T>(key: string): Promise<T | undefined>;
  getMultiple<T>(keys: string[]): Promise<Map<string, T>>;
  put<T>(key: string, value: T): Promise<void>;
  putMultiple(entries: Record<string, unknown>): Promise<void>;
  delete(key: string): Promise<boolean>;
  deleteMultiple(keys: string[]): Promise<number>;
  list<T>(options?: { prefix?: string; limit?: number }): Promise<Map<string, T>>;
  setAlarm(scheduledTime: number | Date): Promise<void>;
  getAlarm(): Promise<number | null>;
  deleteAlarm(): Promise<void>;
}

export class RealDOStorage implements DOStorage {
  constructor(private storage: DurableObjectStorage) {}

  async get<T>(key: string): Promise<T | undefined> {
    return this.storage.get<T>(key);
  }

  async getMultiple<T>(keys: string[]): Promise<Map<string, T>> {
    return this.storage.get<T>(keys);
  }

  async put<T>(key: string, value: T): Promise<void> {
    return this.storage.put(key, value);
  }

  async putMultiple(entries: Record<string, unknown>): Promise<void> {
    return this.storage.put(entries);
  }

  async delete(key: string): Promise<boolean> {
    return this.storage.delete(key);
  }

  async deleteMultiple(keys: string[]): Promise<number> {
    return this.storage.delete(keys);
  }

  async list<T>(options?: { prefix?: string; limit?: number }): Promise<Map<string, T>> {
    return this.storage.list<T>(options);
  }

  async setAlarm(scheduledTime: number | Date): Promise<void> {
    return this.storage.setAlarm(scheduledTime);
  }

  async getAlarm(): Promise<number | null> {
    return this.storage.getAlarm();
  }

  async deleteAlarm(): Promise<void> {
    return this.storage.deleteAlarm();
  }
}
