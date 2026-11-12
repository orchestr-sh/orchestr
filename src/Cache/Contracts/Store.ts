/**
 * Store Contract
 *
 * Defines the low-level interface for cache store implementations.
 * Each driver (file, database, array, etc.) must implement this.
 *
 * Mirrors Laravel's Illuminate\Contracts\Cache\Store.
 */
export interface Store {
  /**
   * Retrieve an item from the cache by key
   */
  get<T = any>(key: string): Promise<T | null>;

  /**
   * Retrieve multiple items from the cache by key
   */
  many<T = any>(keys: string[]): Promise<Record<string, T | null>>;

  /**
   * Store an item in the cache for a given number of seconds
   */
  put<T = any>(key: string, value: T, seconds: number): Promise<boolean>;

  /**
   * Store multiple items in the cache for a given number of seconds
   */
  putMany<T = any>(values: Record<string, T>, seconds: number): Promise<boolean>;

  /**
   * Increment the value of an item in the cache
   */
  increment(key: string, value?: number): Promise<number | boolean>;

  /**
   * Decrement the value of an item in the cache
   */
  decrement(key: string, value?: number): Promise<number | boolean>;

  /**
   * Store an item in the cache indefinitely
   */
  forever<T = any>(key: string, value: T): Promise<boolean>;

  /**
   * Remove an item from the cache
   */
  forget(key: string): Promise<boolean>;

  /**
   * Remove all items from the cache
   */
  flush(): Promise<boolean>;

  /**
   * Get the cache key prefix
   */
  getPrefix(): string;

  /**
   * Store an item only if the key does not already exist.
   * Atomic on stores that support it (used for mutual-exclusion locks).
   */
  add?<T = any>(key: string, value: T, seconds: number): Promise<boolean>;

  /**
   * Extend the lifetime of an existing key without changing its value.
   * A null `seconds` makes the key live forever.
   */
  touch?(key: string, seconds: number | null): Promise<boolean>;

  /**
   * Change the cache key prefix
   */
  setPrefix?(prefix: string): void;
}
