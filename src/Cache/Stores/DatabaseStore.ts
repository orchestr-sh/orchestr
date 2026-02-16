/**
 * DatabaseStore
 *
 * Database-backed cache store. Stores cache entries in a database table.
 * Requires a `cache` table with columns: key (PK), value (text), expiration (int).
 *
 * Mirrors Laravel's Illuminate\Cache\DatabaseStore.
 *
 * @example
 * ```typescript
 * const store = new DatabaseStore({
 *   driver: 'database',
 *   connection: null,
 *   table: 'cache',
 * }, 'app_', application);
 * ```
 */

import type { Store } from '../Contracts/Store';
import type { Application } from '../../Foundation/Application';
import type { DatabaseManager } from '../../Database/DatabaseManager';
import type { Connection } from '../../Database/Connection';

export class DatabaseStore implements Store {
  protected tableName: string;
  protected connectionName?: string;

  constructor(
    protected config: Record<string, any>,
    protected prefix: string = '',
    protected app: Application
  ) {
    this.tableName = config.table || 'cache';
    this.connectionName = config.connection || undefined;
  }

  protected getConnection(): Connection {
    const db = this.app.make<DatabaseManager>('db');
    return db.connection(this.connectionName);
  }

  async get(key: string): Promise<any> {
    const prefixed = this.prefixedKey(key);
    const conn = this.getConnection();
    const now = this.currentTime();

    const row = await conn.table(this.tableName)
      .where('key', '=', prefixed)
      .first();

    if (!row) return null;

    // Check expiration
    if (row.expiration !== 0 && now >= row.expiration) {
      await this.forget(key);
      return null;
    }

    return this.unserialize(row.value);
  }

  async many(keys: string[]): Promise<Record<string, any>> {
    const result: Record<string, any> = {};
    for (const key of keys) {
      result[key] = await this.get(key);
    }
    return result;
  }

  async put(key: string, value: any, seconds: number): Promise<boolean> {
    const prefixed = this.prefixedKey(key);
    const serialized = this.serialize(value);
    const expiration = seconds > 0 ? this.currentTime() + seconds : 0;
    const conn = this.getConnection();

    try {
      // Try update first
      const existing = await conn.table(this.tableName)
        .where('key', '=', prefixed)
        .first();

      if (existing) {
        await conn.table(this.tableName)
          .where('key', '=', prefixed)
          .update({ value: serialized, expiration });
      } else {
        await conn.table(this.tableName)
          .insert({ key: prefixed, value: serialized, expiration });
      }

      return true;
    } catch {
      return false;
    }
  }

  async putMany(values: Record<string, any>, seconds: number): Promise<boolean> {
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

    const prefixed = this.prefixedKey(key);
    const conn = this.getConnection();

    const existing = await conn.table(this.tableName)
      .where('key', '=', prefixed)
      .first();

    if (existing) {
      await conn.table(this.tableName)
        .where('key', '=', prefixed)
        .update({ value: this.serialize(newValue) });
    } else {
      await conn.table(this.tableName)
        .insert({ key: prefixed, value: this.serialize(newValue), expiration: 0 });
    }

    return newValue;
  }

  async decrement(key: string, value: number = 1): Promise<number | boolean> {
    return this.increment(key, -value);
  }

  async forever(key: string, value: any): Promise<boolean> {
    return this.put(key, value, 0);
  }

  async forget(key: string): Promise<boolean> {
    const prefixed = this.prefixedKey(key);
    const conn = this.getConnection();

    try {
      await conn.table(this.tableName)
        .where('key', '=', prefixed)
        .delete();
      return true;
    } catch {
      return false;
    }
  }

  async flush(): Promise<boolean> {
    const conn = this.getConnection();

    try {
      await conn.table(this.tableName).delete();
      return true;
    } catch {
      return false;
    }
  }

  getPrefix(): string {
    return this.prefix;
  }

  protected prefixedKey(key: string): string {
    return `${this.prefix}${key}`;
  }

  protected currentTime(): number {
    return Math.floor(Date.now() / 1000);
  }

  protected serialize(value: any): string {
    return JSON.stringify(value);
  }

  protected unserialize(value: string): any {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
}
