/**
 * Lock Provider Contract
 *
 * Implemented by cache stores that can create atomic locks natively
 * (e.g. Redis via Lua scripts). Stores without atomic lock support fall
 * back to the generic CacheLock, which emulates locking through store
 * reads and writes.
 *
 * Mirrors Laravel's Illuminate\Contracts\Cache\LockProvider.
 */

import type { LockContract } from './Lock';

export interface LockProvider {
  /**
   * Get a lock instance for the given name
   */
  lock(name: string, seconds?: number, owner?: string): LockContract;

  /**
   * Restore a lock instance using the original owner identifier
   */
  restoreLock(name: string, owner: string): LockContract;
}

/**
 * Atomic lock primitives a LockProvider store uses behind its lock
 * instances. Declared structurally so locks do not have to import a
 * concrete store (and tests can inject doubles).
 */
export interface AtomicLockStore {
  /**
   * Atomically acquire the lock when free, or refresh it when the
   * current owner is the given one.
   */
  acquireLock(name: string, seconds: number, owner: string): Promise<boolean>;

  /**
   * Atomically release the lock, but only when owned by the given owner
   */
  releaseLock(name: string, owner: string): Promise<boolean>;

  /**
   * Release the lock regardless of ownership
   */
  forceReleaseLock(name: string): Promise<boolean>;

  /**
   * Read the raw owner value currently holding the lock
   */
  getLockOwner(name: string): Promise<string | null>;
}

/**
 * Determine whether a store provides atomic locks
 */
export function isLockProvider(store: unknown): store is LockProvider & AtomicLockStore {
  const candidate = store as Partial<LockProvider> | undefined;

  return typeof candidate?.lock === 'function' && typeof candidate?.restoreLock === 'function';
}
