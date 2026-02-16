/**
 * Repository
 *
 * High-level cache API that wraps a Store implementation.
 * Provides convenience methods like remember(), pull(), has(),
 * lock(), tags(), and TTL normalization.
 *
 * Mirrors Laravel's Illuminate\Cache\Repository.
 *
 * @example
 * ```typescript
 * const repo = new Repository(new ArrayStore());
 *
 * await repo.put('key', 'value', 3600);
 * const value = await repo.get('key', 'default');
 *
 * const user = await repo.remember('user:1', 3600, async () => {
 *   return await fetchUser(1);
 * });
 * ```
 */

import type { Store } from './Contracts/Store';
import type { RepositoryContract } from './Contracts/Repository';
import type { LockContract } from './Contracts/Lock';
import { CacheLock } from './Locks/CacheLock';
import { TaggedCache } from './Tags/TaggedCache';
import { TagSet } from './Tags/TagSet';

export class Repository implements RepositoryContract {
  protected defaultCacheTime: number | null = null;
  protected storeName: string = '';

  constructor(
    protected store: Store,
    protected config: Record<string, any> = {}
  ) {}

  /**
   * Set the store name (used for events)
   */
  setStoreName(name: string): this {
    this.storeName = name;
    return this;
  }

  async get(key: string, defaultValue?: any): Promise<any> {
    const value = await this.store.get(key);

    if (value !== null && value !== undefined) {
      return value;
    }

    if (typeof defaultValue === 'function') {
      return defaultValue();
    }

    return defaultValue ?? null;
  }

  async many(keys: string[]): Promise<Record<string, any>> {
    return this.store.many(keys);
  }

  async put(key: string, value: any, ttl?: number | Date): Promise<boolean> {
    const seconds = this.getSeconds(ttl);

    if (seconds === null) {
      return this.forever(key, value);
    }

    if (seconds <= 0) {
      return this.forget(key);
    }

    return this.store.put(key, value, seconds);
  }

  async putMany(values: Record<string, any>, ttl?: number | Date): Promise<boolean> {
    const seconds = this.getSeconds(ttl) ?? 0;
    return this.store.putMany(values, seconds);
  }

  async increment(key: string, value: number = 1): Promise<number | boolean> {
    return this.store.increment(key, value);
  }

  async decrement(key: string, value: number = 1): Promise<number | boolean> {
    return this.store.decrement(key, value);
  }

  async forever(key: string, value: any): Promise<boolean> {
    return this.store.forever(key, value);
  }

  async forget(key: string): Promise<boolean> {
    return this.store.forget(key);
  }

  async flush(): Promise<boolean> {
    return this.store.flush();
  }

  getPrefix(): string {
    return this.store.getPrefix();
  }

  // --- High-level Repository methods ---

  async has(key: string): Promise<boolean> {
    const value = await this.store.get(key);
    return value !== null && value !== undefined;
  }

  async missing(key: string): Promise<boolean> {
    return !(await this.has(key));
  }

  async pull(key: string, defaultValue?: any): Promise<any> {
    const value = await this.get(key, defaultValue);

    if (value !== null && value !== undefined && value !== defaultValue) {
      await this.forget(key);
    }

    return value;
  }

  async add(key: string, value: any, ttl?: number | Date): Promise<boolean> {
    if (await this.has(key)) {
      return false;
    }

    return this.put(key, value, ttl);
  }

  async remember(key: string, ttl: number | Date, callback: () => any | Promise<any>): Promise<any> {
    const value = await this.store.get(key);

    if (value !== null && value !== undefined) {
      return value;
    }

    const result = await callback();
    const seconds = this.getSeconds(ttl);

    if (seconds !== null && seconds > 0) {
      await this.store.put(key, result, seconds);
    } else {
      await this.store.forever(key, result);
    }

    return result;
  }

  async rememberForever(key: string, callback: () => any | Promise<any>): Promise<any> {
    const value = await this.store.get(key);

    if (value !== null && value !== undefined) {
      return value;
    }

    const result = await callback();
    await this.store.forever(key, result);

    return result;
  }

  async flexible(key: string, ttl: [number, number], callback: () => any | Promise<any>): Promise<any> {
    const [freshTtl, staleTtl] = ttl;

    // Try to get the cached value with its freshness
    const metaKey = `${key}:flexible_meta`;
    const value = await this.store.get(key);
    const meta = await this.store.get(metaKey);

    if (value !== null && value !== undefined) {
      // Check if still fresh
      if (meta && typeof meta === 'object' && meta.freshUntil) {
        const now = Math.floor(Date.now() / 1000);
        if (now < meta.freshUntil) {
          // Still fresh
          return value;
        }
        // Stale but within total TTL - revalidate in background
        setImmediate(async () => {
          try {
            const newValue = await callback();
            const freshUntil = Math.floor(Date.now() / 1000) + freshTtl;
            await this.store.put(key, newValue, staleTtl);
            await this.store.put(metaKey, { freshUntil }, staleTtl);
          } catch {
            // Silently fail background refresh
          }
        });
        return value;
      }
    }

    // Cache miss - fetch and store
    const result = await callback();
    const freshUntil = Math.floor(Date.now() / 1000) + freshTtl;
    await this.store.put(key, result, staleTtl);
    await this.store.put(metaKey, { freshUntil }, staleTtl);

    return result;
  }

  // --- Locks ---

  lock(name: string, seconds: number = 0, owner?: string): LockContract {
    return new CacheLock(this.store, name, seconds, owner);
  }

  restoreLock(name: string, owner: string): LockContract {
    return new CacheLock(this.store, name, 0, owner);
  }

  // --- Tags ---

  tags(names: string | string[]): TaggedCache {
    const tagNames = Array.isArray(names) ? names : [names];
    const tagSet = new TagSet(this.store, tagNames);
    return new TaggedCache(this.store, tagSet);
  }

  // --- Accessors ---

  getStore(): Store {
    return this.store;
  }

  getDefaultCacheTime(): number | null {
    return this.defaultCacheTime;
  }

  setDefaultCacheTime(seconds: number | null): this {
    this.defaultCacheTime = seconds;
    return this;
  }

  // --- TTL helpers ---

  protected getSeconds(ttl?: number | Date | null): number | null {
    if (ttl === undefined || ttl === null) {
      return this.defaultCacheTime;
    }

    if (ttl instanceof Date) {
      const seconds = Math.floor((ttl.getTime() - Date.now()) / 1000);
      return Math.max(0, seconds);
    }

    return ttl;
  }
}
