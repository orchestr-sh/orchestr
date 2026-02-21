/**
 * ArrayStore
 *
 * In-memory cache store. Perfect for testing and short-lived caching.
 * Supports tags via TaggableStore.
 *
 * Mirrors Laravel's Illuminate\Cache\ArrayStore.
 *
 * @example
 * ```typescript
 * const store = new ArrayStore({ serialize: false }, 'app_');
 * await store.put('key', 'value', 3600);
 * const value = await store.get('key');
 * ```
 */

import type { Store } from '@/Cache/Contracts/Store';

interface CacheEntry {
  value: any;
  expiration: number; // Unix timestamp in seconds, 0 = forever
}

export class ArrayStore implements Store {
  protected storage: Map<string, CacheEntry> = new Map();
  protected shouldSerialize: boolean;

  constructor(
    protected config: Record<string, any> = {},
    protected prefix: string = ''
  ) {
    this.shouldSerialize = config.serialize !== false;
  }

  async get<T = any>(key: string): Promise<T | null> {
    const prefixed = this.prefixedKey(key);
    const entry = this.storage.get(prefixed);

    if (!entry) return null;

    if (this.isExpired(entry.expiration)) {
      this.storage.delete(prefixed);
      return null;
    }

    return this.shouldSerialize ? this.unserialize(entry.value) : entry.value;
  }

  async many<T = any>(keys: string[]): Promise<Record<string, T | null>> {
    const result: Record<string, T | null> = {};
    for (const key of keys) {
      result[key] = await this.get(key);
    }
    return result;
  }

  async put<T = any>(key: string, value: T, seconds: number): Promise<boolean> {
    const prefixed = this.prefixedKey(key);
    const stored = this.shouldSerialize ? this.serialize(value) : value;

    this.storage.set(prefixed, {
      value: stored,
      expiration: seconds > 0 ? this.currentTime() + seconds : 0,
    });

    return true;
  }

  async putMany<T = any>(values: Record<string, T>, seconds: number): Promise<boolean> {
    for (const [key, value] of Object.entries(values)) {
      await this.put(key, value, seconds);
    }
    return true;
  }

  async increment(key: string, value: number = 1): Promise<number | boolean> {
    const current = await this.get(key);
    const newValue = (typeof current === 'number' ? current : 0) + value;

    const prefixed = this.prefixedKey(key);
    const entry = this.storage.get(prefixed);
    const expiration = entry ? entry.expiration : 0;

    this.storage.set(prefixed, {
      value: this.shouldSerialize ? this.serialize(newValue) : newValue,
      expiration,
    });

    return newValue;
  }

  async decrement(key: string, value: number = 1): Promise<number | boolean> {
    return this.increment(key, -value);
  }

  async forever<T = any>(key: string, value: T): Promise<boolean> {
    return this.put(key, value, 0);
  }

  async forget(key: string): Promise<boolean> {
    const prefixed = this.prefixedKey(key);
    return this.storage.delete(prefixed);
  }

  async flush(): Promise<boolean> {
    this.storage.clear();
    return true;
  }

  getPrefix(): string {
    return this.prefix;
  }

  protected prefixedKey(key: string): string {
    return `${this.prefix}${key}`;
  }

  protected isExpired(expiration: number): boolean {
    if (expiration === 0) return false;
    return this.currentTime() >= expiration;
  }

  protected currentTime(): number {
    return Math.floor(Date.now() / 1000);
  }

  protected serialize(value: any): any {
    return JSON.stringify(value);
  }

  protected unserialize(value: any): any {
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }
    return value;
  }
}
