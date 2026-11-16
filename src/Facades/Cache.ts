/**
 * Cache Facade
 *
 * Provides static access to the cache manager and default store.
 *
 * @example
 * ```typescript
 * import { Cache } from '@orchestr-sh/orchestr';
 *
 * // Basic operations
 * await Cache.put('key', 'value', 3600);
 * const value = await Cache.get('key');
 * await Cache.forget('key');
 *
 * // Remember pattern
 * const user = await Cache.remember('user:1', 3600, async () => {
 *   return await fetchUser(1);
 * });
 *
 * // Switch stores
 * await Cache.store('redis').put('key', 'value', 3600);
 *
 * // Tags
 * await Cache.tags(['people', 'artists']).put('John', data, 3600);
 * await Cache.tags('people').flush();
 *
 * // Locks
 * await Cache.lock('processing', 120).get(async () => {
 *   // critical section
 * });
 * ```
 */

import type { CacheConfig, CacheManager } from '@/Cache/CacheManager';
import type { Repository } from '@/Cache/Repository';
import { Facade } from '@/Support/Facade';
import { createFakeCacheManager } from '@/Support/Testing/Fakes/CacheFake';

class CacheFacadeClass extends Facade {
  protected static getFacadeAccessor(): string {
    return 'cache';
  }

  /**
   * Swap the cache for an array-backed fake: every store resolves to an
   * in-memory repository that vanishes with the application.
   *
   * @returns the fake manager, usable through the usual Cache surface
   *
   * @example
   * ```typescript
   * Cache.fake();
   *
   * await Cache.put('key', 'value', 60);
   * await Cache.get('key'); // 'value' - never leaves the process
   * ```
   */
  static fake(): CacheManager {
    const app = this.getFacadeApplication();

    if (!app) {
      throw new Error('Application not initialized. Cannot fake the cache.');
    }

    let config: Partial<CacheConfig> = {};

    try {
      config = ((app.make('config') as any).get?.('cache') ?? {}) as Partial<CacheConfig>;
    } catch {
      // No config repository: the fake builds its own array stores
    }

    const manager = createFakeCacheManager(config);

    app.instance('cache', manager);

    // Drop any cached facade roots so subsequent Cache.* calls resolve the fake.
    this.clearResolvedInstance('cache');
    this.clearResolvedInstance('cache.store');

    return manager;
  }
}

export const Cache = new Proxy(CacheFacadeClass, {
  get(target, prop) {
    // First check if it's a static method on the facade class itself
    if (prop in target) {
      const value = (target as any)[prop];
      if (typeof value === 'function') {
        return value.bind(target);
      }
      return value;
    }

    // Then try to get from the facade root (the CacheManager instance)
    try {
      const root = (target as any).getFacadeRoot() as CacheManager;
      if (root && prop in root) {
        const value = (root as any)[prop];
        if (typeof value === 'function') {
          return (...args: any[]) => value.apply(root, args);
        }
        return value;
      }

      // Also proxy to default store for convenience
      const store = root.store() as Repository;
      if (store && prop in store) {
        const value = (store as any)[prop];
        if (typeof value === 'function') {
          return (...args: any[]) => value.apply(store, args);
        }
        return value;
      }
    } catch (error) {
      // Facade root not available yet
    }

    return undefined;
  },
}) as unknown as typeof CacheFacadeClass & CacheManager & Repository;
