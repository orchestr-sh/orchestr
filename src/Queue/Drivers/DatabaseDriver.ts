/**
 * DatabaseDriver
 *
 * Database queue driver that stores jobs in a database table.
 * This is the most common driver for most applications.
 *
 * Mirrors Laravel's Illuminate\Queue\DatabaseQueue.
 */

import { randomUUID } from 'crypto';
import type { QueueDriver, QueueDriverJob } from '@/Queue/Contracts/QueueDriver';
import type { Job } from '@/Queue/Job';
import { JobPayload } from '@/Queue/JobPayload';
import type { QueueConnectionConfig } from '@/Queue/QueueManager';
import type { Application } from '@/Foundation/Application';
import type { DatabaseManager } from '@/Database/DatabaseManager';
import type { Connection } from '@/Database/Connection';

export class DatabaseDriver implements QueueDriver {
  protected connectionName: string = 'database';
  protected defaultQueue: string;
  protected table: string;
  protected retryAfter: number;

  constructor(
    protected config: QueueConnectionConfig,
    protected app: Application
  ) {
    this.defaultQueue = config.queue || 'default';
    this.table = config.table || 'jobs';
    this.retryAfter = config.retry_after || 90;
  }

  /**
   * Get the database connection
   */
  protected getConnection(): Connection {
    const db = this.app.make<DatabaseManager>('db');
    return db.connection(this.config.connection);
  }

  async size(queue?: string): Promise<number> {
    const queueName = this.getQueue(queue);
    const connection = this.getConnection();

    const result = await connection.table(this.table).where('queue', '=', queueName).count();

    return Number(result) || 0;
  }

  async push(job: Job, queue?: string): Promise<string> {
    const queueName = this.getQueue(queue);
    const payload = JobPayload.create(job);
    const now = Math.floor(Date.now() / 1000);

    const connection = this.getConnection();

    await connection.table(this.table).insert({
      queue: queueName,
      payload: JobPayload.serialize(payload),
      attempts: 0,
      reserved_at: null,
      available_at: now,
      created_at: now,
    });

    return payload.uuid;
  }

  async pushRaw(payload: string, queue?: string, options?: Record<string, any>): Promise<string> {
    const queueName = this.getQueue(queue);
    const now = Math.floor(Date.now() / 1000);
    const delay = options?.delay || 0;

    const connection = this.getConnection();

    await connection.table(this.table).insert({
      queue: queueName,
      payload,
      attempts: 0,
      reserved_at: null,
      available_at: now + delay,
      created_at: now,
    });

    return randomUUID();
  }

  async later(delay: number | Date, job: Job, queue?: string): Promise<string> {
    const queueName = this.getQueue(queue);
    const payload = JobPayload.create(job);
    const now = Math.floor(Date.now() / 1000);

    let availableAt: number;
    if (delay instanceof Date) {
      availableAt = Math.floor(delay.getTime() / 1000);
    } else {
      availableAt = now + delay;
    }

    const connection = this.getConnection();

    await connection.table(this.table).insert({
      queue: queueName,
      payload: JobPayload.serialize(payload),
      attempts: 0,
      reserved_at: null,
      available_at: availableAt,
      created_at: now,
    });

    return payload.uuid;
  }

  async bulk(jobs: Job[], queue?: string): Promise<void> {
    for (const job of jobs) {
      await this.push(job, queue);
    }
  }

  async pop(queue?: string): Promise<QueueDriverJob | null> {
    const queueName = this.getQueue(queue);
    const now = Math.floor(Date.now() / 1000);
    const connection = this.getConnection();

    // Find the next available job
    // First, expire any reserved jobs that have been held too long
    await connection
      .table(this.table)
      .where('queue', '=', queueName)
      .where('reserved_at', '<=', now - this.retryAfter)
      .update({
        reserved_at: null,
      });

    // Get the next available job and reserve it
    const job = await connection
      .table(this.table)
      .where('queue', '=', queueName)
      .where('available_at', '<=', now)
      .whereNull('reserved_at')
      .orderBy('id', 'asc')
      .limit(1)
      .first();

    if (!job) {
      return null;
    }

    // Reserve the job
    await connection
      .table(this.table)
      .where('id', '=', job.id)
      .update({
        reserved_at: now,
        attempts: (job.attempts || 0) + 1,
      });

    return {
      id: String(job.id),
      queue: job.queue,
      payload: job.payload,
      attempts: (job.attempts || 0) + 1,
      reservedAt: now,
      availableAt: job.available_at,
      createdAt: job.created_at,
    };
  }

  async release(id: string, delay: number = 0): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const connection = this.getConnection();

    await connection
      .table(this.table)
      .where('id', '=', id)
      .update({
        reserved_at: null,
        available_at: now + delay,
      });
  }

  async delete(id: string): Promise<void> {
    const connection = this.getConnection();

    await connection.table(this.table).where('id', '=', id).delete();
  }

  async clear(queue?: string): Promise<number> {
    const queueName = this.getQueue(queue);
    const connection = this.getConnection();

    const count = await this.size(queueName);

    await connection.table(this.table).where('queue', '=', queueName).delete();

    return count;
  }

  getConnectionName(): string {
    return this.connectionName;
  }

  setConnectionName(name: string): void {
    this.connectionName = name;
  }

  getQueue(queue?: string): string {
    return queue || this.defaultQueue;
  }
}
