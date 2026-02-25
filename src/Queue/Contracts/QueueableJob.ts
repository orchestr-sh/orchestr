/**
 * QueueableJob Contract
 *
 * Defines the interface for all queueable jobs in the system.
 * Mirrors Laravel's Illuminate\Contracts\Queue\Job interface.
 */

import type { JobMiddleware } from '@/Queue/Middleware/JobMiddleware';

export interface QueueableJob {
  /**
   * The unique identifier for the job
   */
  uuid?: string;

  /**
   * The name of the connection the job should be sent to
   */
  connection?: string;

  /**
   * The name of the queue the job should be sent to
   */
  queue?: string;

  /**
   * The number of seconds before the job should be processed
   */
  delay?: number | Date;

  /**
   * The number of times the job may be attempted
   */
  tries?: number;

  /**
   * The maximum number of unhandled exceptions to allow before failing
   */
  maxExceptions?: number;

  /**
   * The number of seconds the job can run before timing out
   */
  timeout?: number;

  /**
   * The number of seconds to wait before retrying the job
   */
  backoff?: number | number[];

  /**
   * The timestamp after which the job should no longer be retried
   */
  retryUntil?: Date;

  /**
   * Indicate if the job should be marked as failed on timeout
   */
  failOnTimeout?: boolean;

  /**
   * Indicate if the job should be dispatched after all database transactions have committed
   */
  afterCommit?: boolean;

  /**
   * Get the display name of the job
   */
  displayName(): string;

  /**
   * Execute the job
   */
  handle(...args: any[]): Promise<void> | void;

  /**
   * Handle a job failure
   */
  failed?(error: Error): Promise<void> | void;

  /**
   * Get the middleware the job should pass through
   */
  middleware?(): JobMiddleware[];

  /**
   * Serialize the job for storage
   */
  toJSON(): Record<string, any>;
}
