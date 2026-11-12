/**
 * TaggedCache
 *
 * Wraps a cache store to add tagging capabilities.
 * Tagged entries can be flushed as a group by tag name.
 * Dispatches the same cache events as a Repository (with the tag names
 * attached) when an event dispatcher is provided.
 *
 * Mirrors Laravel's Illuminate\Cache\TaggedCache.
 *
 * @example
 * ```typescript
 * // Store tagged entries
 * await Cache.tags(['people', 'artists']).put('John', data, 3600);
 * await Cache.tags(['people', 'authors']).put('Jane', data, 3600);
 *
 * // Retrieve tagged entries
 * const john = await Cache.tags(['people', 'artists']).get('John');
 *
 * // Flush by tag
 * await Cache.tags('people').flush(); // removes all 'people' entries
 * ```
 */

import type { CacheEventDispatcher } from '@/Cache/Contracts/EventDispatcher';
import type { Store } from '@/Cache/Contracts/Store';
import { CacheFlushed } from '@/Cache/Events/CacheFlushed';
import { CacheHit } from '@/Cache/Events/CacheHit';
import { CacheMissed } from '@/Cache/Events/CacheMissed';
import { KeyForgotten } from '@/Cache/Events/KeyForgotten';
import { KeyWritten } from '@/Cache/Events/KeyWritten';
import { TagSet } from './TagSet';

export interface TaggedCacheOptions {
  /** Name of the store the events should carry */
  storeName?: string;

  /** Event dispatcher used to broadcast cache events */
  events?: CacheEventDispatcher;
}

export class TaggedCache {
  protected storeName: string = '';
  protected events?: CacheEventDispatcher;

  constructor(
    protected store: Store,
    protected tags: TagSet,
    options: TaggedCacheOptions = {}
  ) {
    this.storeName = options.storeName ?? '';
    this.events = options.events;
  }

  async get<T = any>(key: string): Promise<T | null> {
    const taggedKey = await this.taggedItemKey(key);
    const value = await this.store.get<T>(taggedKey);

    if (value !== null && value !== undefined) {
      await this.broadcast(new CacheHit(this.storeName, taggedKey, value, this.tagNames()));

      return value;
    }

    await this.broadcast(new CacheMissed(this.storeName, taggedKey, this.tagNames()));

    return null;
  }

  async many<T = any>(keys: string[]): Promise<Record<string, T | null>> {
    const result: Record<string, T | null> = {};
    for (const key of keys) {
      result[key] = await this.get<T>(key);
    }
    return result;
  }

  async put<T = any>(key: string, value: T, seconds: number): Promise<boolean> {
    const taggedKey = await this.taggedItemKey(key);
    const result = await this.store.put<T>(taggedKey, value, seconds);

    await this.broadcast(new KeyWritten(this.storeName, taggedKey, value, seconds, this.tagNames()));

    return result;
  }

  async putMany<T = any>(values: Record<string, T>, seconds: number): Promise<boolean> {
    let success = true;
    for (const [key, value] of Object.entries(values)) {
      if (!(await this.put(key, value, seconds))) {
        success = false;
      }
    }
    return success;
  }

  async increment(key: string, value: number = 1): Promise<number | boolean> {
    const taggedKey = await this.taggedItemKey(key);
    const result = await this.store.increment(taggedKey, value);

    if (typeof result === 'number') {
      await this.broadcast(new KeyWritten(this.storeName, taggedKey, result, null, this.tagNames()));
    }

    return result;
  }

  async decrement(key: string, value: number = 1): Promise<number | boolean> {
    const taggedKey = await this.taggedItemKey(key);
    const result = await this.store.decrement(taggedKey, value);

    if (typeof result === 'number') {
      await this.broadcast(new KeyWritten(this.storeName, taggedKey, result, null, this.tagNames()));
    }

    return result;
  }

  async forever<T = any>(key: string, value: T): Promise<boolean> {
    const taggedKey = await this.taggedItemKey(key);
    const result = await this.store.forever<T>(taggedKey, value);

    await this.broadcast(new KeyWritten(this.storeName, taggedKey, value, null, this.tagNames()));

    return result;
  }

  async forget(key: string): Promise<boolean> {
    const taggedKey = await this.taggedItemKey(key);
    const result = await this.store.forget(taggedKey);

    await this.broadcast(new KeyForgotten(this.storeName, taggedKey, this.tagNames()));

    return result;
  }

  /**
   * Flush all entries for these tags.
   * Resets the tag namespace so old tagged keys become unreachable.
   */
  async flush(): Promise<boolean> {
    await this.tags.flush();

    await this.broadcast(new CacheFlushed(this.storeName, this.tagNames()));

    return true;
  }

  async has(key: string): Promise<boolean> {
    const value = await this.get(key);
    return value !== null && value !== undefined;
  }

  async pull<T = any>(key: string, defaultValue?: T): Promise<T | null> {
    const value = await this.get<T>(key);

    if (value !== null && value !== undefined) {
      await this.forget(key);
      return value;
    }

    return defaultValue ?? null;
  }

  async remember<T = any>(key: string, ttl: number, callback: () => T | Promise<T>): Promise<T> {
    const value = await this.get<T>(key);

    if (value !== null && value !== undefined) {
      return value;
    }

    const result = await callback();
    await this.put(key, result, ttl);
    return result;
  }

  async rememberForever<T = any>(key: string, callback: () => T | Promise<T>): Promise<T> {
    const value = await this.get<T>(key);

    if (value !== null && value !== undefined) {
      return value;
    }

    const result = await callback();
    await this.forever(key, result);
    return result;
  }

  /**
   * Get the prefixed key for a tagged item
   */
  protected async taggedItemKey(key: string): Promise<string> {
    const namespace = await this.tags.getNamespace();
    return `${namespace}:${key}`;
  }

  /**
   * Get the tag set
   */
  getTags(): TagSet {
    return this.tags;
  }

  /**
   * Tag names attached to dispatched cache events
   */
  protected tagNames(): string[] {
    return this.tags.getNames();
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
}
