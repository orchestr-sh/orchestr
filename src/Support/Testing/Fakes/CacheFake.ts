/**
 * CacheFake
 *
 * `Cache.fake()` swaps the `cache` binding for a manager whose every store
 * is an in-memory array: writes are recorded for assertions and vanish
 * with the application, so tests never read or evict real entries.
 *
 * Mirrors Illuminate\Support\Facades\Cache::fake() - Laravel's fake is
 * likewise "an array store behind the normal Repository", keeping the full
 * Repository surface (get/put/forget/remember...) available to the
 * application and its tests.
 */

import type { CacheConfig, StoreConfig } from '@/Cache/CacheManager';
import type { Repository } from '@/Cache/Repository';
import { CacheManager } from '@/Cache/CacheManager';
import { ArrayStore } from '@/Cache/Stores/ArrayStore';

/**
 * A cache manager that answers every store name - configured or not - with
 * an isolated array store, so `store('anything')` keeps working while
 * faked.
 */
export class FakeCacheManager extends CacheManager {
  constructor(config: Partial<CacheConfig> = {}) {
    const prefix = config.prefix ?? 'orchestr_cache_fake_';

    const stores: Record<string, StoreConfig> = { array: { driver: 'array' } };

    for (const name of Object.keys(config.stores ?? {})) {
      stores[name] = { driver: 'array' };
    }

    super({ default: 'array', prefix, stores });

    this.registerDriver('array', (storeConfig) => new ArrayStore(storeConfig, prefix));
  }

  /**
   * Resolve a store by name, defining an array store for names that were
   * never configured
   */
  override store(name?: string): Repository {
    const storeName = name ?? this.getDefaultDriver();

    if (!this.getStoreNames().includes(storeName)) {
      this.getConfig().stores[storeName] = { driver: 'array' };
    }

    return super.store(storeName);
  }
}

/**
 * Build a cache manager where every store is a fresh array store
 */
export function createFakeCacheManager(config: Partial<CacheConfig> = {}): FakeCacheManager {
  return new FakeCacheManager(config);
}
