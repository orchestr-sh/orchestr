/**
 * Repository Contract
 *
 * Defines the high-level cache API that wraps a store.
 * Mirrors Laravel's Illuminate\Contracts\Cache\Repository.
 */

import type { LockContract } from './Lock';
import type { Store } from './Store';

export interface RepositoryContract extends Store {
  /**
   * Determine if an item exists in the cache
   */
  has(key: string): Promise<boolean>;

  /**
   * Determine if an item doesn't exist in the cache
   */
  missing(key: string): Promise<boolean>;

  /**
   * Retrieve an item from the cache and delete it
   */
  pull<T = any>(key: string, defaultValue?: T): Promise<T | null>;

  /**
   * Store an item in the cache if the key does not exist
   */
  add<T = any>(key: string, value: T, ttl?: number | Date): Promise<boolean>;

  /**
   * Get an item from the cache, or execute the given closure and store the result
   */
  remember<T = any>(key: string, ttl: number | Date, callback: () => T | Promise<T>): Promise<T>;

  /**
   * Get an item from the cache, or execute the given closure and store the result forever
   */
  rememberForever<T = any>(key: string, callback: () => T | Promise<T>): Promise<T>;

  /**
   * Get an item from the cache using flexible stale-while-revalidate strategy
   */
  flexible<T = any>(key: string, ttl: [number, number], callback: () => T | Promise<T>): Promise<T>;

  /**
   * Get a lock instance
   */
  lock(name: string, seconds?: number, owner?: string): LockContract;

  /**
   * Restore a lock instance using the owner identifier
   */
  restoreLock(name: string, owner: string): LockContract;

  /**
   * Get the underlying store implementation
   */
  getStore(): Store;

  /**
   * Get the default cache time in seconds
   */
  getDefaultCacheTime(): number | null;

  /**
   * Set the default cache time in seconds
   */
  setDefaultCacheTime(seconds: number | null): this;
}
