/**
 * DatabaseFailedJobProvider
 *
 * Stores failed jobs in a database table.
 * Mirrors Laravel's Illuminate\Queue\Failed\DatabaseUuidFailedJobProvider.
 */

import { randomUUID } from 'crypto';
import type { FailedJobProvider, FailedJobRecord } from './FailedJobProvider';
import type { Application } from '@/Foundation/Application';
import type { DatabaseManager } from '@/Database/DatabaseManager';
import type { Connection } from '@/Database/Connection';

export class DatabaseFailedJobProvider implements FailedJobProvider {
  protected table: string;
  protected databaseConnection?: string;

  constructor(
    protected app: Application,
    config: { table?: string; database?: string }
  ) {
    this.table = config.table || 'failed_jobs';
    this.databaseConnection = config.database;
  }

  /**
   * Get the database connection
   */
  protected getConnection(): Connection {
    const db = this.app.make<DatabaseManager>('db');
    return db.connection(this.databaseConnection);
  }

  async log(connection: string, queue: string, payload: string, exception: Error): Promise<string> {
    const uuid = randomUUID();
    const conn = this.getConnection();

    await conn.table(this.table).insert({
      uuid,
      connection,
      queue,
      payload,
      exception: this.formatException(exception),
      failed_at: new Date().toISOString(),
    });

    return uuid;
  }

  async all(): Promise<FailedJobRecord[]> {
    const conn = this.getConnection();
    const results = await conn.table(this.table).orderBy('id', 'desc').get();

    return results as FailedJobRecord[];
  }

  async find(id: string | number): Promise<FailedJobRecord | null> {
    const conn = this.getConnection();
    const result = await conn.table(this.table).where('id', '=', id).orWhere('uuid', '=', String(id)).first();

    return (result as FailedJobRecord) || null;
  }

  async forget(id: string | number): Promise<boolean> {
    const conn = this.getConnection();
    const deleted = await conn.table(this.table).where('id', '=', id).orWhere('uuid', '=', String(id)).delete();

    return deleted > 0;
  }

  async flush(hours?: number): Promise<void> {
    const conn = this.getConnection();

    if (hours !== undefined && hours > 0) {
      const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
      await conn.table(this.table).where('failed_at', '<=', cutoff).delete();
    } else {
      await conn.table(this.table).delete();
    }
  }

  async count(connection?: string, queue?: string): Promise<number> {
    const conn = this.getConnection();
    let query = conn.table(this.table);

    if (connection) {
      query = query.where('connection', '=', connection);
    }

    if (queue) {
      query = query.where('queue', '=', queue);
    }

    return Number(await query.count()) || 0;
  }

  /**
   * Format an exception for storage
   */
  protected formatException(exception: Error): string {
    const lines: string[] = [`${exception.constructor.name}: ${exception.message}`];

    if (exception.stack) {
      lines.push('', exception.stack);
    }

    return lines.join('\n');
  }
}
