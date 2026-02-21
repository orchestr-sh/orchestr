/**
 * ThrottlesExceptions Middleware
 *
 * When a job throws too many exceptions within a given time window,
 * subsequent attempts are delayed to prevent rapid failure loops.
 *
 * Mirrors Laravel's Illuminate\Queue\Middleware\ThrottlesExceptions.
 *
 * @example
 * ```typescript
 * class ProcessPodcast extends Job {
 *   middleware() {
 *     return [
 *       new ThrottlesExceptions(10, 5) // 10 exceptions per 5 minutes
 *         .backoff(5) // Wait 5 minutes before retrying
 *     ];
 *   }
 * }
 * ```
 */

import type { Job } from '@/Queue/Job';
import type { JobMiddleware } from './JobMiddleware';

// In-memory exception tracking
const exceptionStore: Map<string, { count: number; resetAt: number }> = new Map();

export class ThrottlesExceptions implements JobMiddleware {
  /**
   * The number of minutes to back off for
   */
  protected backoffMinutes: number = 5;

  /**
   * The prefix for the throttle key
   */
  protected keyPrefix: string = '';

  /**
   * Whether to retry the job or delete it when throttled
   */
  protected shouldRetryOnThrottle: boolean = true;

  constructor(
    /**
     * The maximum number of exceptions allowed
     */
    protected maxExceptions: number = 10,

    /**
     * The number of minutes in the decay window
     */
    protected decayMinutes: number = 10
  ) {}

  async handle(job: Job, next: () => Promise<void>): Promise<void> {
    const key = this.getKey(job);
    const now = Math.floor(Date.now() / 1000);

    // Clean up expired entries
    const existing = exceptionStore.get(key);
    if (existing && existing.resetAt <= now) {
      exceptionStore.delete(key);
    }

    const current = exceptionStore.get(key);

    // Check if throttled
    if (current && current.count >= this.maxExceptions) {
      if (this.shouldRetryOnThrottle) {
        job.release(this.backoffMinutes * 60);
      } else {
        job.delete();
      }
      return;
    }

    try {
      await next();
    } catch (error) {
      // Record the exception
      if (current) {
        current.count++;
      } else {
        exceptionStore.set(key, {
          count: 1,
          resetAt: now + this.decayMinutes * 60,
        });
      }

      throw error;
    }
  }

  /**
   * Get the throttle key for this job
   */
  protected getKey(job: Job): string {
    const prefix = this.keyPrefix || job.displayName();
    return `throttle:${prefix}`;
  }

  /**
   * Set the number of minutes to back off for when throttled
   */
  backoff(minutes: number): this {
    this.backoffMinutes = minutes;
    return this;
  }

  /**
   * Set a custom key prefix
   */
  by(key: string): this {
    this.keyPrefix = key;
    return this;
  }

  /**
   * Indicate the job should NOT be retried when throttled
   */
  dontRetry(): this {
    this.shouldRetryOnThrottle = false;
    return this;
  }
}
