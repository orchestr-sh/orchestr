/**
 * CacheEventMutex
 *
 * Cache-store-backed mutual exclusion for scheduled events, powering the
 * `withoutOverlapping()` and `onOneServer()` modifiers. Mirrors Laravel's
 * `Illuminate\Cache\CacheEventMutex`: acquisition is an atomic cache lock
 * so only one process - on one machine or across a fleet - may run a
 * given event at a time.
 */

import type { LockContract } from '@/Cache/Contracts/Lock';

/**
 * Anything able to mint named, expiring locks: the CacheManager, a
 * Repository, or an app-registered `cache` binding.
 */
export interface Locker {
  lock(name: string, seconds?: number, owner?: string): LockContract;
}

export class CacheEventMutex {
  /** Live locks by mutex name, so releases carry the acquiring owner */
  protected locks: Map<string, LockContract> = new Map();

  constructor(protected readonly locker: Locker) {}

  /**
   * Attempt to take out the mutex for an event, expiring after the given
   * number of seconds.
   *
   * When `reentrant` is true (the onOneServer case) a lock this process
   * still owns is renewed rather than re-raced, so the winning server can
   * keep running the event on later cycles while every other process is
   * locked out until expiry. With `reentrant` false (withoutOverlapping)
   * every call attempts a brand-new owner, so a second concurrent run -
   * even in the same process - is blocked while the first holds the lock.
   */
  async create(mutexName: string, expiresAfter: number, reentrant = false): Promise<boolean> {
    const held = this.locks.get(mutexName);

    if (reentrant && held) {
      // Still ours? Renew in place so the owning server keeps its claim.
      if (await held.get()) {
        return true;
      }

      // Expired: drop the stale reference before racing for a fresh owner.
      this.locks.delete(mutexName);
    }

    const lock = this.locker.lock(mutexName, expiresAfter);

    if (!(await lock.get())) {
      // Someone else (possibly an in-flight run of this same process) owns
      // the lock. Leave any existing entry untouched - it still describes
      // the live holder and its release path.
      return false;
    }

    this.locks.set(mutexName, lock);

    return true;
  }

  /**
   * Release the mutex, no-op when it is not currently held by this process.
   */
  async release(mutexName: string): Promise<void> {
    const lock = this.locks.get(mutexName);

    if (!lock) {
      return;
    }

    this.locks.delete(mutexName);

    await lock.release();
  }
}
