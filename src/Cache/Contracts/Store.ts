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
  get(key: string): Promise<any>;

  /**
   * Retrieve multiple items from the cache by key
   */
  many(keys: string[]): Promise<Record<string, any>>;

  /**
   * Store an item in the cache for a given number of seconds
   */
  put(key: string, value: any, seconds: number): Promise<boolean>;

  /**
   * Store multiple items in the cache for a given number of seconds
   */
  putMany(values: Record<string, any>, seconds: number): Promise<boolean>;

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
  forever(key: string, value: any): Promise<boolean>;

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
}
