/**
 * SyncDriver
 *
 * Synchronous queue driver that executes jobs immediately.
 * Useful for local development and testing.
 *
 * Mirrors Laravel's Illuminate\Queue\SyncQueue.
 */

import type { QueueDriver, QueueDriverJob } from '@/Queue/Contracts/QueueDriver';
import type { Job } from '@/Queue/Job';
import type { QueueConnectionConfig } from '@/Queue/QueueManager';

export class SyncDriver implements QueueDriver {
  protected connectionName: string = 'sync';

  constructor(protected config: QueueConnectionConfig) {}

  async size(_queue?: string): Promise<number> {
    return 0;
  }

  async push(job: Job, _queue?: string): Promise<string> {
    try {
      await job.handle();
    } catch (error) {
      if (job.failed) {
        await job.failed(error as Error);
      }
      throw error;
    }

    return job.uuid;
  }

  async pushRaw(_payload: string, _queue?: string, _options?: Record<string, any>): Promise<string> {
    throw new Error('Sync driver does not support pushing raw payloads.');
  }

  async later(_delay: number | Date, job: Job, _queue?: string): Promise<string> {
    return this.push(job);
  }

  async bulk(jobs: Job[], _queue?: string): Promise<void> {
    for (const job of jobs) {
      await this.push(job);
    }
  }

  async pop(_queue?: string): Promise<QueueDriverJob | null> {
    return null;
  }

  async release(_id: string, _delay?: number): Promise<void> {
    // No-op for sync driver
  }

  async delete(_id: string): Promise<void> {
    // No-op for sync driver
  }

  async clear(_queue?: string): Promise<number> {
    return 0;
  }

  getConnectionName(): string {
    return this.connectionName;
  }

  setConnectionName(name: string): void {
    this.connectionName = name;
  }

  getQueue(queue?: string): string {
    return queue || this.config.queue || 'default';
  }
}
