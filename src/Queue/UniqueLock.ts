/**
 * UniqueLock
 *
 * Cache-lock enforcement for jobs implementing ShouldBeUnique.
 * The lock is acquired at dispatch time and released by the worker
 * once the job finishes (or on final failure). For
 * ShouldBeUniqueUntilProcessing jobs the worker releases it as soon
 * as the job is popped for processing.
 *
 * Mirrors Laravel's Illuminate\Queue\UniqueLock.
 */

import type { CacheManager } from '@/Cache/CacheManager';
import type { Container } from '@/Container/Container';
import type { Job } from './Job';
import { isShouldBeUnique } from './Contracts/ShouldBeUnique';

/**
 * Handle returned once a unique lock has been acquired. It is stored on
 * the job payload so the worker can release the lock after processing.
 */
export interface UniqueLockToken {
  key: string;
  owner: string;
}

export class UniqueLock {
  /**
   * Prefix used for all unique-job cache locks
   */
  static readonly PREFIX = 'orchestr_queue_unique';

  /**
   * Build the cache lock key for a job class and unique ID
   */
  static keyFor(jobClass: string, uniqueId: string): string {
    return `${UniqueLock.PREFIX}:${jobClass}.${uniqueId}`;
  }

  constructor(protected container: Container) {}

  /**
   * Attempt to acquire the unique lock for a job.
   *
   * @returns The lock token when acquired, or null when the job is not
   * unique (nothing to lock) or the lock is already held by another
   * queued instance (the dispatch should be skipped).
   * @throws Error when a unique job is dispatched without the cache subsystem
   */
  async acquire(job: Job): Promise<UniqueLockToken | 'not-unique' | 'locked'> {
    if (!isShouldBeUnique(job)) {
      return 'not-unique';
    }

    const repository = this.repository();
    const key = UniqueLock.keyFor(job.constructor.name, job.uniqueId());
    const lock = repository.lock(key, job.uniqueFor ?? 0);

    const acquired = await lock.get();

    if (!acquired) {
      return 'locked';
    }

    return { key, owner: lock.owner() };
  }

  /**
   * Best-effort release of a previously acquired lock, restoring the
   * original owner so other processes' locks are never released by mistake.
   */
  async release(token: Partial<UniqueLockToken> | null | undefined): Promise<void> {
    if (!token || !token.key || !token.owner) {
      return;
    }

    try {
      const repository = this.repository();
      await repository.restoreLock(token.key, token.owner).release();
    } catch {
      // Best effort: a missing cache store or connectivity problem must
      // never mask the job result. uniqueFor TTL bounds the leak.
    }
  }

  /**
   * Determine whether a job holds the unique lock right now
   */
  async locked(job: Job): Promise<boolean> {
    if (!isShouldBeUnique(job)) {
      return false;
    }

    try {
      const repository = this.repository();
      const key = UniqueLock.keyFor(job.constructor.name, job.uniqueId());
      return (await repository.get(key)) !== null;
    } catch {
      return false;
    }
  }

  /**
   * Resolve the default cache store repository
   */
  protected repository() {
    if (!this.container.bound('cache')) {
      throw new Error(
        'ShouldBeUnique jobs require the cache subsystem. Register the CacheServiceProvider ' +
          '(the queue manager needs a "cache" binding) before dispatching unique jobs.'
      );
    }

    return this.container.make<CacheManager>('cache').store();
  }
}
