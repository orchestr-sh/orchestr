/**
 * FileStore
 *
 * File-based cache store. Stores each cache entry as a JSON file
 * on the filesystem, organized by a two-character hash prefix.
 *
 * Mirrors Laravel's Illuminate\Cache\FileStore.
 *
 * @example
 * ```typescript
 * const store = new FileStore({
 *   driver: 'file',
 *   path: 'storage/framework/cache/data',
 * }, 'app_');
 * ```
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
import type { Store } from '@/Cache/Contracts/Store';

export class FileStore implements Store {
  protected cachePath: string;

  constructor(
    protected config: Record<string, any>,
    protected prefix: string = ''
  ) {
    this.cachePath = config.path || 'storage/framework/cache/data';
  }

  async get<T = any>(key: string): Promise<T | null> {
    return this.getPayload(key);
  }

  async many<T = any>(keys: string[]): Promise<Record<string, T | null>> {
    const result: Record<string, T | null> = {};
    for (const key of keys) {
      result[key] = await this.get(key);
    }
    return result;
  }

  async put<T = any>(key: string, value: T, seconds: number): Promise<boolean> {
    const filePath = this.path(key);

    await this.ensureDirectory(path.dirname(filePath));

    const expiration = seconds > 0 ? this.currentTime() + seconds : 9999999999; // ~2286, effectively forever

    const content = JSON.stringify({
      expiration,
      value: this.serialize(value),
    });

    try {
      await fs.writeFile(filePath, content, 'utf-8');
      return true;
    } catch {
      return false;
    }
  }

  async putMany<T = any>(values: Record<string, T>, seconds: number): Promise<boolean> {
    let success = true;
    for (const [key, value] of Object.entries(values)) {
      if (!(await this.put(key, value, seconds))) {
        success = false;
      }
    }
    return success;
  }

  async increment(key: string, value: number = 1): Promise<number | boolean> {
    const current = await this.get(key);
    const newValue = (typeof current === 'number' ? current : 0) + value;
    await this.forever(key, newValue);
    return newValue;
  }

  async decrement(key: string, value: number = 1): Promise<number | boolean> {
    return this.increment(key, -value);
  }

  async forever<T = any>(key: string, value: T): Promise<boolean> {
    return this.put(key, value, 0);
  }

  async forget(key: string): Promise<boolean> {
    const filePath = this.path(key);
    try {
      await fs.unlink(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async flush(): Promise<boolean> {
    try {
      await fs.rm(this.cachePath, { recursive: true, force: true });
      await fs.mkdir(this.cachePath, { recursive: true });
      return true;
    } catch {
      return false;
    }
  }

  getPrefix(): string {
    return this.prefix;
  }

  /**
   * Get the full file path for a cache key
   */
  protected path(key: string): string {
    const prefixed = `${this.prefix}${key}`;
    const hash = this.hash(prefixed);
    // Two-level directory structure using first 2+2 chars of hash
    const parts = [hash.substring(0, 2), hash.substring(2, 4)];
    return path.join(this.cachePath, ...parts, hash);
  }

  /**
   * Get the hashed key
   */
  protected hash(key: string): string {
    return createHash('sha256').update(key).digest('hex');
  }

  /**
   * Read and validate the cache payload
   */
  protected async getPayload(key: string): Promise<any> {
    const filePath = this.path(key);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(content);

      // Check expiration
      if (data.expiration !== 0 && this.currentTime() >= data.expiration) {
        await this.forget(key);
        return null;
      }

      return this.unserialize(data.value);
    } catch {
      return null;
    }
  }

  protected async ensureDirectory(dir: string): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
  }

  protected currentTime(): number {
    return Math.floor(Date.now() / 1000);
  }

  protected serialize(value: any): any {
    return JSON.stringify(value);
  }

  protected unserialize(value: any): any {
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }
    return value;
  }
}
