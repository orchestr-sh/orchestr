/**
 * RateLimited Middleware
 *
 * Rate limits job execution. When the rate limit is exceeded,
 * the job is released back onto the queue.
 *
 * Mirrors Laravel's Illuminate\Queue\Middleware\RateLimited.
 *
 * @example
 * ```typescript
 * class ProcessPodcast extends Job {
 *   middleware() {
 *     return [new RateLimited('podcasts', 10, 60)];
 *   }
 * }
 * ```
 */

import type { Job } from '@/Queue/Job';
import type { JobMiddleware } from './JobMiddleware';

// Simple in-memory rate limiter store
const rateLimiterStore: Map<string, { count: number; resetAt: number }> = new Map();

export class RateLimited implements JobMiddleware {
  /**
   * The number of seconds to release the job for when rate limited
   */
  protected releaseAfterSeconds: number = 0;

  constructor(
    /**
     * The rate limiter key
     */
    protected key: string,

    /**
     * The maximum number of attempts within the decay period
     */
    protected maxAttempts: number = 1,

    /**
     * The number of seconds until the rate limit resets
     */
    protected decaySeconds: number = 60
  ) {}

  async handle(job: Job, next: () => Promise<void>): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const limiter = rateLimiterStore.get(this.key);

    // Check if the rate limit has expired
    if (limiter && limiter.resetAt <= now) {
      rateLimiterStore.delete(this.key);
    }

    const current = rateLimiterStore.get(this.key);

    if (current && current.count >= this.maxAttempts) {
      // Rate limited - release the job back
      const retryAfter = current.resetAt - now;
      job.release(this.releaseAfterSeconds || retryAfter);
      return;
    }

    // Increment the counter
    if (current) {
      current.count++;
    } else {
      rateLimiterStore.set(this.key, {
        count: 1,
        resetAt: now + this.decaySeconds,
      });
    }

    await next();
  }

  /**
   * Set the number of seconds to release the job for
   */
  releaseAfter(seconds: number): this {
    this.releaseAfterSeconds = seconds;
    return this;
  }
}
