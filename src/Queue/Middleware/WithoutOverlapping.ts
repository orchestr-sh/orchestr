/**
 * WithoutOverlapping Middleware
 *
 * Prevents a job from running if another instance with the same
 * key is currently being processed.
 *
 * Mirrors Laravel's Illuminate\Queue\Middleware\WithoutOverlapping.
 *
 * @example
 * ```typescript
 * class UpdateSearchIndex extends Job {
 *   middleware() {
 *     return [new WithoutOverlapping(this.productId)];
 *   }
 * }
 * ```
 */

import type { Job } from '@/Queue/Job';
import type { JobMiddleware } from './JobMiddleware';

// Simple in-memory lock store
const lockStore: Map<string, { expiresAt: number }> = new Map();

export class WithoutOverlapping implements JobMiddleware {
  /**
   * The number of seconds to release the job for if locked
   */
  protected releaseAfterSeconds: number = 0;

  /**
   * The number of seconds the lock should be held
   */
  protected lockExpiresAfter: number = 0;

  /**
   * Whether to skip the job entirely if locked (vs releasing back to queue)
   */
  protected shouldDontRelease: boolean = false;

  constructor(
    /**
     * The lock key to prevent overlapping
     */
    protected key: string | number,

    /**
     * The prefix for the lock key
     */
    protected prefix: string = 'overlap:'
  ) {}

  async handle(job: Job, next: () => Promise<void>): Promise<void> {
    const lockKey = `${this.prefix}${this.key}`;
    const now = Math.floor(Date.now() / 1000);

    // Clean up expired locks
    const existing = lockStore.get(lockKey);
    if (existing && existing.expiresAt > 0 && existing.expiresAt <= now) {
      lockStore.delete(lockKey);
    }

    // Check if locked
    if (lockStore.has(lockKey)) {
      if (this.shouldDontRelease) {
        // Skip the job entirely
        job.delete();
        return;
      }

      // Release back onto the queue
      job.release(this.releaseAfterSeconds || 5);
      return;
    }

    // Acquire lock
    const expiresAt = this.lockExpiresAfter > 0 ? now + this.lockExpiresAfter : 0;
    lockStore.set(lockKey, { expiresAt });

    try {
      await next();
    } finally {
      // Release lock
      lockStore.delete(lockKey);
    }
  }

  /**
   * Set the number of seconds to release the job for if locked
   */
  releaseAfter(seconds: number): this {
    this.releaseAfterSeconds = seconds;
    return this;
  }

  /**
   * Set the lock expiration time in seconds
   */
  expireAfter(seconds: number): this {
    this.lockExpiresAfter = seconds;
    return this;
  }

  /**
   * Indicate the job should be deleted if locked (instead of released)
   */
  dontRelease(): this {
    this.shouldDontRelease = true;
    return this;
  }
}
