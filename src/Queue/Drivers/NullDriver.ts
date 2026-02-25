/**
 * NullDriver
 *
 * Null queue driver that discards all jobs.
 * Useful for testing when you want to verify jobs are dispatched
 * but don't want them to actually execute.
 *
 * Mirrors Laravel's Illuminate\Queue\NullQueue.
 */

import type { QueueDriver, QueueDriverJob } from '@/Queue/Contracts/QueueDriver';
import type { Job } from '@/Queue/Job';
import type { QueueConnectionConfig } from '@/Queue/QueueManager';

export class NullDriver implements QueueDriver {
  protected connectionName: string = 'null';

  constructor(protected config: QueueConnectionConfig) {}

  async size(_queue?: string): Promise<number> {
    return 0;
  }

  async push(job: Job, _queue?: string): Promise<string> {
    return job.uuid;
  }

  async pushRaw(_payload: string, _queue?: string, _options?: Record<string, any>): Promise<string> {
    return '';
  }

  async later(_delay: number | Date, job: Job, _queue?: string): Promise<string> {
    return job.uuid;
  }

  async bulk(_jobs: Job[], _queue?: string): Promise<void> {
    // Discard all jobs
  }

  async pop(_queue?: string): Promise<QueueDriverJob | null> {
    return null;
  }

  async release(_id: string, _delay?: number): Promise<void> {
    // No-op
  }

  async delete(_id: string): Promise<void> {
    // No-op
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
