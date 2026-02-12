/**
 * Config - Laravel's configuration repository
 * Illuminate\Config\Repository
 *
 * Provides dot-notation access to configuration values
 */
export class Config {
  private items: Record<string, any> = {};

  constructor(items: Record<string, any> = {}) {
    this.items = items;
  }

  /**
   * Determine if the given configuration value exists
   * Laravel: config()->has('app.name')
   *
   * @param {string} key
   * @returns {boolean}
   */
  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  /**
   * Get the specified configuration value
   * Laravel: config('app.name') or config()->get('app.name')
   *
   * Supports dot notation: 'database.connections.mysql.host'
   *
   * @param {string} key
   * @param {any} defaultValue
   * @returns {any}
   */
  get<T = any>(key: string, defaultValue?: T): T {
    const keys = key.split('.');
    let value: any = this.items;

    for (const segment of keys) {
      if (value && typeof value === 'object' && segment in value) {
        value = value[segment];
      } else {
        return defaultValue as T;
      }
    }

    return value as T;
  }

  /**
   * Get all configuration values
   *
   * @returns {Record<string, any>}
   */
  all(): Record<string, any> {
    return this.items;
  }

  /**
   * Set a given configuration value
   * Laravel: config(['app.name' => 'My App'])
   *
   * @param {string | Record<string, any>} key
   * @param {any} value
   */
  set(key: string | Record<string, any>, value?: any): void {
    if (typeof key === 'object') {
      // Set multiple values
      for (const [k, v] of Object.entries(key)) {
        this.set(k, v);
      }
      return;
    }

    const keys = key.split('.');
    let current = this.items;

    // Navigate to the parent of the final key
    for (let i = 0; i < keys.length - 1; i++) {
      const segment = keys[i];

      if (!current[segment] || typeof current[segment] !== 'object') {
        current[segment] = {};
      }

      current = current[segment];
    }

    // Set the final value
    current[keys[keys.length - 1]] = value;
  }

  /**
   * Prepend a value onto an array configuration value
   * Laravel: config()->prepend('app.providers', ServiceProvider::class)
   *
   * @param {string} key
   * @param {any} value
   */
  prepend(key: string, value: any): void {
    const array = this.get<any[]>(key, []);

    if (!Array.isArray(array)) {
      throw new Error(`Configuration value at [${key}] is not an array.`);
    }

    array.unshift(value);
    this.set(key, array);
  }

  /**
   * Push a value onto an array configuration value
   * Laravel: config()->push('app.providers', ServiceProvider::class)
   *
   * @param {string} key
   * @param {any} value
   */
  push(key: string, value: any): void {
    const array = this.get<any[]>(key, []);

    if (!Array.isArray(array)) {
      throw new Error(`Configuration value at [${key}] is not an array.`);
    }

    array.push(value);
    this.set(key, array);
  }

  /**
   * Remove a configuration value
   *
   * @param {string} key
   */
  forget(key: string): void {
    const keys = key.split('.');
    let current = this.items;

    // Navigate to the parent of the final key
    for (let i = 0; i < keys.length - 1; i++) {
      const segment = keys[i];

      if (!current[segment] || typeof current[segment] !== 'object') {
        return; // Key doesn't exist
      }

      current = current[segment];
    }

    // Delete the final key
    delete current[keys[keys.length - 1]];
  }

  /**
   * Get many configuration values
   *
   * @param {string[]} keys
   * @returns {Record<string, any>}
   */
  getMany(keys: string[]): Record<string, any> {
    const result: Record<string, any> = {};

    for (const key of keys) {
      result[key] = this.get(key);
    }

    return result;
  }

  /**
   * Merge configuration values (deep merge)
   *
   * @param {Record<string, any>} items
   */
  merge(items: Record<string, any>): void {
    this.items = this.deepMerge(this.items, items);
  }

  /**
   * Deep merge two objects
   */
  private deepMerge(target: any, source: any): any {
    const output = { ...target };

    if (this.isObject(target) && this.isObject(source)) {
      Object.keys(source).forEach((key) => {
        if (this.isObject(source[key])) {
          if (!(key in target)) {
            output[key] = source[key];
          } else {
            output[key] = this.deepMerge(target[key], source[key]);
          }
        } else {
          output[key] = source[key];
        }
      });
    }

    return output;
  }

  /**
   * Check if value is a plain object
   */
  private isObject(item: any): boolean {
    return item && typeof item === 'object' && !Array.isArray(item);
  }
}
