/**
 * Repository
 *
 * High-level cache API that wraps a Store implementation.
 * Provides convenience methods like remember(), pull(), has(),
 * lock(), tags(), and TTL normalization, and broadcasts the Laravel
 * cache events (CacheHit, CacheMissed, KeyWritten, KeyForgotten,
 * CacheFlushed) through the optional event dispatcher.
 *
 * remember()/rememberForever() gain optional stampede protection driven
 * by the `cache.remember` configuration: when enabled, the value is
 * computed behind a lock (released in `finally`) and the cache is
 * re-checked after acquiring it so concurrent callers execute the
 * callback only once.
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

import type { CacheEventDispatcher } from './Contracts/EventDispatcher';
import type { LockContract } from './Contracts/Lock';
import type { RepositoryContract } from './Contracts/Repository';
import type { Store } from './Contracts/Store';
import { isLockProvider } from './Contracts/LockProvider';
import { CacheFlushed } from './Events/CacheFlushed';
import { CacheHit } from './Events/CacheHit';
import { CacheMissed } from './Events/CacheMissed';
import { KeyForgotten } from './Events/KeyForgotten';
import { KeyWritten } from './Events/KeyWritten';
import { CacheLock } from './Locks/CacheLock';
import { TaggedCache } from './Tags/TaggedCache';
import { TagSet } from './Tags/TagSet';

/** Prefix for the stampede-protection lock keys */
const REMEMBER_LOCK_PREFIX = 'orchestr_cache_remember:';

/** Default TTL (seconds) for stampede-protection locks */
const DEFAULT_REMEMBER_LOCK_SECONDS = 30;

/** Poll interval (ms) while waiting for another process to populate a remember() key */
const REMEMBER_POLL_MS = 25;

export class Repository implements RepositoryContract {
  protected defaultCacheTime: number | null = null;
  protected storeName: string = '';
  protected events?: CacheEventDispatcher;

  constructor(
    protected store: Store,
    protected config: Record<string, any> = {},
    events?: CacheEventDispatcher
  ) {
    this.events = events;
  }

  /**
   * Set the store name (used for events)
   */
  setStoreName(name: string): this {
    this.storeName = name;
    return this;
  }

  /**
   * Set the event dispatcher used to broadcast cache events
   */
  setEventDispatcher(events?: CacheEventDispatcher): this {
    this.events = events;
    return this;
  }

  /**
   * Get the event dispatcher used to broadcast cache events
   */
  getEventDispatcher(): CacheEventDispatcher | undefined {
    return this.events;
  }

  async get<T = any>(key: string, defaultValue?: T | (() => T)): Promise<T | null> {
    const value = await this.store.get<T>(key);

    if (value !== null && value !== undefined) {
      await this.broadcast(new CacheHit(this.storeName, key, value, this.eventTags()));

      return value;
    }

    await this.broadcast(new CacheMissed(this.storeName, key, this.eventTags()));

    if (typeof defaultValue === 'function') {
      return (defaultValue as () => T)();
    }

    return defaultValue ?? null;
  }

  async many<T = any>(keys: string[]): Promise<Record<string, T | null>> {
    return this.store.many(keys);
  }

  async put<T = any>(key: string, value: T, ttl?: number | Date): Promise<boolean> {
    const seconds = this.getSeconds(ttl);

    if (seconds === null) {
      return this.forever(key, value);
    }

    if (seconds <= 0) {
      return this.forget(key);
    }

    const result = await this.store.put(key, value, seconds);

    await this.broadcast(new KeyWritten(this.storeName, key, value, seconds, this.eventTags()));

    return result;
  }

  async putMany<T = any>(values: Record<string, T>, ttl?: number | Date): Promise<boolean> {
    const seconds = this.getSeconds(ttl) ?? 0;
    return this.store.putMany(values, seconds);
  }

  async increment(key: string, value: number = 1): Promise<number | boolean> {
    const result = await this.store.increment(key, value);

    if (typeof result === 'number') {
      await this.broadcast(new KeyWritten(this.storeName, key, result, null, this.eventTags()));
    }

    return result;
  }

  async decrement(key: string, value: number = 1): Promise<number | boolean> {
    const result = await this.store.decrement(key, value);

    if (typeof result === 'number') {
      await this.broadcast(new KeyWritten(this.storeName, key, result, null, this.eventTags()));
    }

    return result;
  }

  async forever<T = any>(key: string, value: T): Promise<boolean> {
    const result = await this.store.forever(key, value);

    await this.broadcast(new KeyWritten(this.storeName, key, value, null, this.eventTags()));

    return result;
  }

  async forget(key: string): Promise<boolean> {
    const result = await this.store.forget(key);

    await this.broadcast(new KeyForgotten(this.storeName, key, this.eventTags()));

    return result;
  }

  async flush(): Promise<boolean> {
    const result = await this.store.flush();

    await this.broadcast(new CacheFlushed(this.storeName, this.eventTags()));

    return result;
  }

  /**
   * Extend the lifetime of an existing key without changing its value.
   * Uses the store's native touch when available and otherwise reads the
   * value back and re-stores it. A null TTL (or omitted) stores forever.
   */
  async touch(key: string, ttl?: number | Date | null): Promise<boolean> {
    const seconds = ttl === undefined || ttl === null ? null : this.getSeconds(ttl);

    if (typeof this.store.touch === 'function') {
      return this.store.touch(key, seconds);
    }

    const value = await this.store.get(key);

    if (value === null || value === undefined) {
      return false;
    }

    if (seconds !== null && seconds > 0) {
      return this.store.put(key, value, seconds);
    }

    return this.store.forever(key, value);
  }

  getPrefix(): string {
    return this.store.getPrefix();
  }

  /**
   * Change the key prefix on the underlying store (when supported)
   */
  setPrefix(prefix: string): this {
    this.store.setPrefix?.(prefix);
    return this;
  }

  // --- High-level Repository methods ---

  async has(key: string): Promise<boolean> {
    const value = await this.store.get(key);
    return value !== null && value !== undefined;
  }

  async missing(key: string): Promise<boolean> {
    return !(await this.has(key));
  }

  async pull<T = any>(key: string, defaultValue?: T): Promise<T | null> {
    const value = await this.get(key, defaultValue);

    if (value !== null && value !== undefined && value !== defaultValue) {
      await this.forget(key);
    }

    return value;
  }

  async add<T = any>(key: string, value: T, ttl?: number | Date): Promise<boolean> {
    if (await this.has(key)) {
      return false;
    }

    return this.put(key, value, ttl);
  }

  async remember<T = any>(key: string, ttl: number | Date, callback: () => T | Promise<T>): Promise<T> {
    return this.rememberInternal(key, this.getSeconds(ttl), false, callback);
  }

  async rememberForever<T = any>(key: string, callback: () => T | Promise<T>): Promise<T> {
    return this.rememberInternal(key, null, true, callback);
  }

  async flexible<T = any>(key: string, ttl: [number, number], callback: () => T | Promise<T>): Promise<T> {
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

  /**
   * Shared remember implementation (DRY): both remember() and
   * rememberForever() run through here, optionally guarded by a lock
   * when `cache.remember.lock` is enabled.
   */
  protected async rememberInternal<T = any>(
    key: string,
    seconds: number | null,
    forever: boolean,
    callback: () => T | Promise<T>
  ): Promise<T> {
    const value = await this.get<T>(key);

    if (value !== null && value !== undefined) {
      return value;
    }

    if (!this.usesRememberLock()) {
      return this.rememberCompute(key, seconds, forever, callback);
    }

    const lock = this.lock(this.rememberLockName(key), this.rememberLockSeconds());

    if (await lock.get()) {
      return this.rememberWithinLock(lock, key, seconds, forever, callback);
    }

    // Another process holds the lock and is computing the value. Wait
    // for it to populate the cache, retrying the acquisition until the
    // lock's TTL elapses.
    const deadline = Date.now() + this.rememberLockSeconds() * 1000;

    while (Date.now() < deadline) {
      await this.wait(REMEMBER_POLL_MS);

      const cached = await this.store.get<T>(key);

      if (cached !== null && cached !== undefined) {
        await this.broadcast(new CacheHit(this.storeName, key, cached, this.eventTags()));
        return cached;
      }

      if (await lock.get()) {
        return this.rememberWithinLock(lock, key, seconds, forever, callback);
      }
    }

    // The holder never finished (crashed or timed out): compute
    // unguarded as a last resort so callers still receive a value.
    return this.rememberCompute(key, seconds, forever, callback);
  }

  /**
   * Compute the value while the lock is held, re-checking the cache
   * first and always releasing the lock in `finally`.
   */
  protected async rememberWithinLock<T = any>(
    lock: LockContract,
    key: string,
    seconds: number | null,
    forever: boolean,
    callback: () => T | Promise<T>
  ): Promise<T> {
    try {
      const cached = await this.store.get<T>(key);

      if (cached !== null && cached !== undefined) {
        await this.broadcast(new CacheHit(this.storeName, key, cached, this.eventTags()));
        return cached;
      }

      return await this.rememberCompute(key, seconds, forever, callback);
    } finally {
      await lock.release();
    }
  }

  /**
   * Execute the remember callback and store the result
   */
  protected async rememberCompute<T = any>(
    key: string,
    seconds: number | null,
    forever: boolean,
    callback: () => T | Promise<T>
  ): Promise<T> {
    const result = await callback();

    if (!forever && seconds !== null && seconds > 0) {
      await this.put(key, result, seconds);
    } else {
      await this.forever(key, result);
    }

    return result;
  }

  /**
   * Whether `cache.remember.lock` enables stampede protection
   */
  protected usesRememberLock(): boolean {
    return !!this.config?.remember?.lock;
  }

  /**
   * TTL in seconds for stampede-protection locks (`cache.remember.lock_seconds`)
   */
  protected rememberLockSeconds(): number {
    const seconds = Number(this.config?.remember?.lock_seconds);

    return Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_REMEMBER_LOCK_SECONDS;
  }

  /**
   * Lock name guarding a remember() key against cache stampedes
   */
  protected rememberLockName(key: string): string {
    return `${REMEMBER_LOCK_PREFIX}${key}`;
  }

  protected wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // --- Locks ---

  lock(name: string, seconds: number = 0, owner?: string): LockContract {
    // Stores with atomic lock primitives (Redis) hand out their own
    // lock implementations so acquisition/release stay race-free.
    if (isLockProvider(this.store)) {
      return this.store.lock(name, seconds, owner);
    }

    return new CacheLock(this.store, name, seconds, owner);
  }

  restoreLock(name: string, owner: string): LockContract {
    if (isLockProvider(this.store)) {
      return this.store.restoreLock(name, owner);
    }

    return new CacheLock(this.store, name, 0, owner);
  }

  // --- Tags ---

  tags(names: string | string[]): TaggedCache {
    const tagNames = Array.isArray(names) ? names : [names];
    const tagSet = new TagSet(this.store, tagNames);

    return new TaggedCache(this.store, tagSet, {
      storeName: this.storeName,
      events: this.events,
    });
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

  // --- Events ---

  /**
   * Tag names attached to dispatched cache events (empty for plain repositories)
   */
  protected eventTags(): string[] {
    return [];
  }

  /**
   * Broadcast a cache event through the configured dispatcher (if any)
   */
  protected async broadcast(event: Parameters<CacheEventDispatcher['dispatch']>[0]): Promise<void> {
    if (!this.events) {
      return;
    }

    await this.events.dispatch(event);
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
