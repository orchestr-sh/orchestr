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

import type { CacheEventDispatcher } from './Contracts/EventDispatcher';
import type { Store } from './Contracts/Store';
import { Repository } from './Repository';

export interface StoreConfig {
  driver: string;
  [key: string]: any;
}

/**
 * Stampede-protection options for remember()/rememberForever()
 * (mirrors the `cache.remember` config keys).
 */
export interface CacheRememberConfig {
  /** Acquire a lock around remember() callbacks */
  lock?: boolean;

  /** Lock TTL (seconds) used while guarding remember() */
  lock_seconds?: number;
}

export interface CacheConfig {
  default: string;
  prefix: string;
  stores: Record<string, StoreConfig>;
  remember?: CacheRememberConfig;
}

export type StoreFactory = (config: StoreConfig) => Store;

export class CacheManager {
  protected stores: Map<string, Repository> = new Map();
  protected driverFactories: Map<string, StoreFactory> = new Map();
  protected eventDispatcher?: CacheEventDispatcher;

  constructor(protected config: CacheConfig) {}

  /**
   * Register a cache store driver factory
   */
  registerDriver(name: string, factory: StoreFactory): void {
    this.driverFactories.set(name, factory);
  }

  /**
   * Set the event dispatcher given to every repository this manager
   * creates so they can broadcast cache events. Repositories that are
   * already live receive the dispatcher too.
   */
  setEventDispatcher(events?: CacheEventDispatcher): this {
    this.eventDispatcher = events;

    for (const repository of this.stores.values()) {
      repository.setEventDispatcher(events);
    }

    return this;
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
    const repository = new Repository(
      store,
      {
        remember: this.config.remember,
        ...storeConfig,
      },
      this.eventDispatcher
    );
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
   * Change the cache key prefix. Live stores are updated in place and
   * the new prefix is used for stores created afterwards.
   */
  setPrefix(prefix: string): this {
    this.config.prefix = prefix;

    for (const repository of this.stores.values()) {
      repository.setPrefix(prefix);
    }

    return this;
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

  async get<T = any>(key: string, defaultValue?: T | (() => T)): Promise<T | null> {
    return this.store().get<T>(key, defaultValue);
  }

  async put<T = any>(key: string, value: T, ttl?: number | Date): Promise<boolean> {
    return this.store().put<T>(key, value, ttl);
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

  async remember<T = any>(key: string, ttl: number | Date, callback: () => T | Promise<T>): Promise<T> {
    return this.store().remember<T>(key, ttl, callback);
  }

  async rememberForever<T = any>(key: string, callback: () => T | Promise<T>): Promise<T> {
    return this.store().rememberForever<T>(key, callback);
  }

  async forever<T = any>(key: string, value: T): Promise<boolean> {
    return this.store().forever<T>(key, value);
  }

  async pull<T = any>(key: string, defaultValue?: T): Promise<T | null> {
    return this.store().pull<T>(key, defaultValue);
  }

  async many<T = any>(keys: string[]): Promise<Record<string, T | null>> {
    return this.store().many<T>(keys);
  }

  async putMany<T = any>(values: Record<string, T>, ttl?: number | Date): Promise<boolean> {
    return this.store().putMany<T>(values, ttl);
  }

  async increment(key: string, value?: number): Promise<number | boolean> {
    return this.store().increment(key, value);
  }

  async decrement(key: string, value?: number): Promise<number | boolean> {
    return this.store().decrement(key, value);
  }

  async add<T = any>(key: string, value: T, ttl?: number | Date): Promise<boolean> {
    return this.store().add<T>(key, value, ttl);
  }

  async touch(key: string, ttl?: number | Date | null): Promise<boolean> {
    return this.store().touch(key, ttl);
  }

  lock(name: string, seconds: number = 0, owner?: string) {
    return this.store().lock(name, seconds, owner);
  }

  restoreLock(name: string, owner: string) {
    return this.store().restoreLock(name, owner);
  }
}
