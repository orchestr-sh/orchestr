/**
 * RateLimited Middleware
 *
 * Rate limits job execution. When the rate limit is exceeded,
 * the job is released back onto the queue.
 *
 * The counting is delegated to the application's RateLimiter service -
 * the same cache-backed bucket the HTTP `throttle` middleware drives - so
 * a job and an HTTP route registered under one key share their window
 * instead of keeping parallel books (DRY). When no application is running
 * the middleware falls back to a process-local array-backed limiter.
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

import type { RateLimiter } from '@/Cache/RateLimiter';
import type { Job } from '@/Queue/Job';
import { RateLimiter as CacheRateLimiter } from '@/Cache/RateLimiter';
import { Repository } from '@/Cache/Repository';
import { ArrayStore } from '@/Cache/Stores/ArrayStore';
import { getGlobalApp } from '@/Support/helpers';
import type { JobMiddleware } from './JobMiddleware';

/**
 * Process-local limiter used when the application has not bound the
 * container's 'limiter'; counters live in an array cache store so the
 * decay-window semantics match the HTTP side exactly
 */
let fallbackLimiter: RateLimiter | null = null;

function resolveLimiter(): RateLimiter {
  const app = getGlobalApp();

  if (app) {
    try {
      if (app.bound('limiter')) {
        return app.make<RateLimiter>('limiter');
      }
    } catch {
      // Container not ready for it; fall through to the process-local limiter
    }
  }

  fallbackLimiter ??= new CacheRateLimiter(
    new Repository(new ArrayStore({ serialize: false }, 'orchestr_queue_limiter:'))
  );

  return fallbackLimiter;
}

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
    const limiter = resolveLimiter();

    if (await limiter.tooManyAttempts(this.key, this.maxAttempts)) {
      // Rate limited - release the job back for the rest of the window
      const retryAfter = await limiter.retryAfter(this.key);
      job.release(this.releaseAfterSeconds || retryAfter);
      return;
    }

    await limiter.hit(this.key, this.maxAttempts, this.decaySeconds);

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
