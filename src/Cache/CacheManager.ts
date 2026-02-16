/**
 * CacheManager
 *
 * Manages multiple cache store connections.
 * Follows the Manager pattern established by DatabaseManager and QueueManager.
 *
 * Mirrors Laravel's Illuminate\Cache\CacheManager.
 *
 * @example
 * ```typescript
 * const manager = new CacheManager({
 *   default: 'file',
 *   prefix: 'app_',
 *   stores: {
 *     file: { driver: 'file', path: 'storage/cache' },
 *     array: { driver: 'array' },
 *     database: { driver: 'database', table: 'cache' },
 *   },
 * });
 *
 * // Use default store
 * const repo = manager.store();
 * await repo.put('key', 'value', 3600);
 *
 * // Use specific store
 * const redis = manager.store('redis');
 * ```
 */

import type { Store } from './Contracts/Store';
import { Repository } from './Repository';

export interface StoreConfig {
  driver: string;
  [key: string]: any;
}

export interface CacheConfig {
  default: string;
  prefix: string;
  stores: Record<string, StoreConfig>;
}

export type StoreFactory = (config: StoreConfig) => Store;

export class CacheManager {
  protected stores: Map<string, Repository> = new Map();
  protected driverFactories: Map<string, StoreFactory> = new Map();

  constructor(protected config: CacheConfig) {}

  /**
   * Register a cache store driver factory
   */
  registerDriver(name: string, factory: StoreFactory): void {
    this.driverFactories.set(name, factory);
  }

  /**
   * Get a cache store instance by name
   */
  store(name?: string): Repository {
    const storeName = name || this.config.default;

    if (this.stores.has(storeName)) {
      return this.stores.get(storeName)!;
    }

    const repository = this.createStore(storeName);
    this.stores.set(storeName, repository);

    return repository;
  }

  /**
   * Create a new cache store instance
   */
  protected createStore(name: string): Repository {
    const storeConfig = this.config.stores[name];

    if (!storeConfig) {
      throw new Error(`Cache store [${name}] not configured.`);
    }

    const factory = this.driverFactories.get(storeConfig.driver);

    if (!factory) {
      throw new Error(
        `Cache driver [${storeConfig.driver}] not registered. ` +
        `Available drivers: ${Array.from(this.driverFactories.keys()).join(', ')}`
      );
    }

    const store = factory(storeConfig);
    const repository = new Repository(store, storeConfig);
    repository.setStoreName(name);

    return repository;
  }

  /**
   * Extend the manager with a custom driver
   */
  extend(driver: string, factory: StoreFactory): void {
    this.registerDriver(driver, factory);
  }

  /**
   * Get the default store name
   */
  getDefaultDriver(): string {
    return this.config.default;
  }

  /**
   * Set the default store name
   */
  setDefaultDriver(name: string): void {
    this.config.default = name;
  }

  /**
   * Get the cache prefix
   */
  getPrefix(): string {
    return this.config.prefix;
  }

  /**
   * Get all configured store names
   */
  getStoreNames(): string[] {
    return Object.keys(this.config.stores);
  }

  /**
   * Get the store configuration
   */
  getStoreConfig(name?: string): StoreConfig {
    const storeName = name || this.config.default;
    const config = this.config.stores[storeName];

    if (!config) {
      throw new Error(`Cache store [${storeName}] not configured.`);
    }

    return config;
  }

  /**
   * Get the full configuration
   */
  getConfig(): CacheConfig {
    return this.config;
  }

  /**
   * Purge a store from the cache (remove the cached instance)
   */
  purge(name?: string): void {
    const storeName = name || this.config.default;
    this.stores.delete(storeName);
  }

  /**
   * Purge all cached store instances
   */
  purgeAll(): void {
    this.stores.clear();
  }

  // --- Proxy methods to default store for convenience ---

  async get(key: string, defaultValue?: any): Promise<any> {
    return this.store().get(key, defaultValue);
  }

  async put(key: string, value: any, ttl?: number | Date): Promise<boolean> {
    return this.store().put(key, value, ttl);
  }

  async has(key: string): Promise<boolean> {
    return this.store().has(key);
  }

  async forget(key: string): Promise<boolean> {
    return this.store().forget(key);
  }

  async flush(): Promise<boolean> {
    return this.store().flush();
  }

  async remember(key: string, ttl: number | Date, callback: () => any | Promise<any>): Promise<any> {
    return this.store().remember(key, ttl, callback);
  }

  async rememberForever(key: string, callback: () => any | Promise<any>): Promise<any> {
    return this.store().rememberForever(key, callback);
  }

  async forever(key: string, value: any): Promise<boolean> {
    return this.store().forever(key, value);
  }

  async pull(key: string, defaultValue?: any): Promise<any> {
    return this.store().pull(key, defaultValue);
  }

  async many(keys: string[]): Promise<Record<string, any>> {
    return this.store().many(keys);
  }

  async putMany(values: Record<string, any>, ttl?: number | Date): Promise<boolean> {
    return this.store().putMany(values, ttl);
  }

  async increment(key: string, value?: number): Promise<number | boolean> {
    return this.store().increment(key, value);
  }

  async decrement(key: string, value?: number): Promise<number | boolean> {
    return this.store().decrement(key, value);
  }

  async add(key: string, value: any, ttl?: number | Date): Promise<boolean> {
    return this.store().add(key, value, ttl);
  }
}
