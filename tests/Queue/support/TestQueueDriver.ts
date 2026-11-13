/**
 * In-memory QueueDriver test double
 *
 * Implements the QueueDriver contract with plain arrays so the Worker can
 * be exercised without a database or Redis. Reserves popped jobs (they stay
 * visible to size()/inspection until delete or release), honours available
 * times for delayed jobs, and can expose a stub transaction connection to
 * drive after-commit deferral tests.
 */

import type { QueueDriver, QueueDriverJob, TransactionAwareConnection } from '@/Queue/Contracts/QueueDriver';
import type { Job } from '@/Queue/Job';
import { JobPayload, type JobPayloadData } from '@/Queue/JobPayload';

interface StoredJob {
  id: string;
  queue: string;
  payload: string;
  attempts: number;
  reservedAt: number | null;
  availableAt: number;
  createdAt: number;
}

export class TestQueueDriver implements QueueDriver {
  public jobs: StoredJob[] = [];
  public released: Array<{ id: string; delay: number }> = [];
  public deleted: string[] = [];
  public connectionName: string = 'test';
  public defaultQueue: string = 'default';
  public transactionConnection: TransactionAwareConnection | null = null;

  async size(queue?: string): Promise<number> {
    return this.jobs.filter((job) => job.queue === this.getQueue(queue)).length;
  }

  async push(job: Job, queue?: string): Promise<string> {
    const payload = JobPayload.create(job);
    const now = Math.floor(Date.now() / 1000);

    this.jobs.push({
      id: payload.uuid,
      queue: this.getQueue(queue),
      payload: JobPayload.serialize(payload),
      attempts: 0,
      reservedAt: null,
      availableAt: now,
      createdAt: now,
    });

    return payload.uuid;
  }

  async pushRaw(payload: string, queue?: string, _options?: Record<string, any>): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    let parsed: JobPayloadData;

    try {
      parsed = JobPayload.deserialize(payload);
    } catch {
      parsed = { uuid: `raw-${this.jobs.length}` } as JobPayloadData;
    }

    this.jobs.push({
      id: parsed.uuid,
      queue: this.getQueue(queue),
      payload,
      attempts: 0,
      reservedAt: null,
      availableAt: now,
      createdAt: now,
    });

    return parsed.uuid;
  }

  async later(delay: number | Date, job: Job, queue?: string): Promise<string> {
    const id = await this.push(job, queue);
    const stored = this.jobs.find((entry) => entry.id === id)!;

    stored.availableAt =
      delay instanceof Date ? Math.floor(delay.getTime() / 1000) : Math.floor(Date.now() / 1000) + delay;

    return id;
  }

  async bulk(jobs: Job[], queue?: string): Promise<void> {
    for (const job of jobs) {
      await this.push(job, queue);
    }
  }

  async pop(queue?: string): Promise<QueueDriverJob | null> {
    const queueName = this.getQueue(queue);
    const now = Math.floor(Date.now() / 1000);

    const stored = this.jobs.find(
      (job) => job.queue === queueName && job.reservedAt === null && job.availableAt <= now
    );

    if (!stored) {
      return null;
    }

    stored.reservedAt = now;
    stored.attempts += 1;

    return { ...stored };
  }

  async release(id: string, delay: number = 0): Promise<void> {
    const stored = this.jobs.find((job) => job.id === id);

    if (!stored) {
      return;
    }

    stored.reservedAt = null;
    stored.availableAt = Math.floor(Date.now() / 1000) + delay;
    this.released.push({ id, delay });
  }

  async delete(id: string): Promise<void> {
    const index = this.jobs.findIndex((job) => job.id === id);

    if (index !== -1) {
      this.jobs.splice(index, 1);
    }

    this.deleted.push(id);
  }

  async clear(queue?: string): Promise<number> {
    const queueName = this.getQueue(queue);
    const before = this.jobs.length;

    this.jobs = this.jobs.filter((job) => job.queue !== queueName);

    return before - this.jobs.length;
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

  /**
   * Optional stub connection for after-commit deferral tests
   */
  getTransactionConnection(): TransactionAwareConnection | null {
    return this.transactionConnection;
  }

  /**
   * Read the deserialized payload of a stored job (test inspection helper)
   */
  payloadOf(id: string): JobPayloadData | undefined {
    const stored = this.jobs.find((job) => job.id === id);

    return stored ? JobPayload.deserialize(stored.payload) : undefined;
  }
}
