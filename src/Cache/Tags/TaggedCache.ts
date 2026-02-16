/**
 * TaggedCache
 *
 * Wraps a cache store to add tagging capabilities.
 * Tagged entries can be flushed as a group by tag name.
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

import type { Store } from '../Contracts/Store';
import { TagSet } from './TagSet';

export class TaggedCache {
  constructor(
    protected store: Store,
    protected tags: TagSet
  ) {}

  async get(key: string): Promise<any> {
    const taggedKey = await this.taggedItemKey(key);
    return this.store.get(taggedKey);
  }

  async many(keys: string[]): Promise<Record<string, any>> {
    const result: Record<string, any> = {};
    for (const key of keys) {
      result[key] = await this.get(key);
    }
    return result;
  }

  async put(key: string, value: any, seconds: number): Promise<boolean> {
    const taggedKey = await this.taggedItemKey(key);
    return this.store.put(taggedKey, value, seconds);
  }

  async putMany(values: Record<string, any>, seconds: number): Promise<boolean> {
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
    return this.store.increment(taggedKey, value);
  }

  async decrement(key: string, value: number = 1): Promise<number | boolean> {
    const taggedKey = await this.taggedItemKey(key);
    return this.store.decrement(taggedKey, value);
  }

  async forever(key: string, value: any): Promise<boolean> {
    const taggedKey = await this.taggedItemKey(key);
    return this.store.forever(taggedKey, value);
  }

  async forget(key: string): Promise<boolean> {
    const taggedKey = await this.taggedItemKey(key);
    return this.store.forget(taggedKey);
  }

  /**
   * Flush all entries for these tags.
   * Resets the tag namespace so old tagged keys become unreachable.
   */
  async flush(): Promise<boolean> {
    await this.tags.flush();
    return true;
  }

  async has(key: string): Promise<boolean> {
    const value = await this.get(key);
    return value !== null;
  }

  async pull(key: string, defaultValue?: any): Promise<any> {
    const value = await this.get(key);
    if (value !== null) {
      await this.forget(key);
      return value;
    }
    return defaultValue ?? null;
  }

  async remember(key: string, ttl: number, callback: () => any | Promise<any>): Promise<any> {
    const value = await this.get(key);

    if (value !== null) {
      return value;
    }

    const result = await callback();
    await this.put(key, result, ttl);
    return result;
  }

  async rememberForever(key: string, callback: () => any | Promise<any>): Promise<any> {
    const value = await this.get(key);

    if (value !== null) {
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
}
