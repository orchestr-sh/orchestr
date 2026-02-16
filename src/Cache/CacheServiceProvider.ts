/**
 * CacheServiceProvider
 *
 * Registers cache services into the container.
 * Mirrors Laravel's Illuminate\Cache\CacheServiceProvider.
 */

import { ServiceProvider } from '../Foundation/ServiceProvider';
import { CacheManager } from './CacheManager';
import type { CacheConfig } from './CacheManager';
import { ArrayStore } from './Stores/ArrayStore';
import { FileStore } from './Stores/FileStore';
import { DatabaseStore } from './Stores/DatabaseStore';
import { NullStore } from './Stores/NullStore';

export class CacheServiceProvider extends ServiceProvider {
  /**
   * Register cache services
   */
  register(): void {
    this.app.singleton('cache', () => {
      const config = this.getConfig();
      const manager = new CacheManager(config);

      // Register built-in drivers
      manager.registerDriver('array', (storeConfig) =>
        new ArrayStore(storeConfig, config.prefix)
      );

      manager.registerDriver('file', (storeConfig) =>
        new FileStore(storeConfig, config.prefix)
      );

      manager.registerDriver('database', (storeConfig) =>
        new DatabaseStore(storeConfig, config.prefix, this.app)
      );

      manager.registerDriver('null', () =>
        new NullStore()
      );

      return manager;
    });

    // Bind the default store directly for convenience
    this.app.singleton('cache.store', () => {
      return this.app.make<CacheManager>('cache').store();
    });
  }

  /**
   * Get the cache configuration
   */
  protected getConfig(): CacheConfig {
    try {
      const configService = this.app.make('config') as any;
      const cacheConfig = configService?.items?.cache || configService?.get?.('cache');
      if (cacheConfig) {
        return {
          default: cacheConfig.default || 'array',
          prefix: cacheConfig.prefix || 'orchestr_cache_',
          stores: cacheConfig.stores || { array: { driver: 'array' } },
        };
      }
    } catch {
      // Config service not available
    }

    // Default configuration
    return {
      default: 'array',
      prefix: 'orchestr_cache_',
      stores: {
        array: {
          driver: 'array',
          serialize: false,
        },
        null: {
          driver: 'null',
        },
      },
    };
  }
}
