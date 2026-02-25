/**
 * QueueDriver Contract
 *
 * Defines the interface for queue driver implementations.
 * Mirrors Laravel's Illuminate\Contracts\Queue\Queue interface.
 */

import type { Job } from '@/Queue/Job';

export interface QueueDriverJob {
  id: string;
  queue: string;
  payload: string;
  attempts: number;
  reservedAt: number | null;
  availableAt: number;
  createdAt: number;
}

export interface QueueDriver {
  /**
   * Get the size of the queue
   */
  size(queue?: string): Promise<number>;

  /**
   * Push a new job onto the queue
   */
  push(job: Job, queue?: string): Promise<string>;

  /**
   * Push a raw payload onto the queue
   */
  pushRaw(payload: string, queue?: string, options?: Record<string, any>): Promise<string>;

  /**
   * Push a new job onto the queue after a delay
   */
  later(delay: number | Date, job: Job, queue?: string): Promise<string>;

  /**
   * Push an array of jobs onto the queue
   */
  bulk(jobs: Job[], queue?: string): Promise<void>;

  /**
   * Pop the next job off of the queue
   */
  pop(queue?: string): Promise<QueueDriverJob | null>;

  /**
   * Release a reserved job back onto the queue
   */
  release(id: string, delay?: number): Promise<void>;

  /**
   * Delete a reserved job
   */
  delete(id: string): Promise<void>;

  /**
   * Delete all of the jobs from the queue
   */
  clear(queue?: string): Promise<number>;

  /**
   * Get the connection name for the queue
   */
  getConnectionName(): string;

  /**
   * Set the connection name for the queue
   */
  setConnectionName(name: string): void;

  /**
   * Get the default queue name
   */
  getQueue(queue?: string): string;
}
