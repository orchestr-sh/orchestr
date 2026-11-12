/**
 * RedisLock
 *
 * Atomic lock backed by a cache store that exposes the AtomicLockStore
 * primitives (RedisStore does). Acquisition, TTL refresh, and release
 * each run as a single Redis command round trip (Lua script), so two
 * processes can never hold the same lock and only the owner can release
 * it.
 *
 * Mirrors Laravel's Illuminate\Cache\RedisLock.
 */

import type { AtomicLockStore } from '@/Cache/Contracts/LockProvider';
import { Lock } from './Lock';

export class RedisLock extends Lock {
  constructor(
    protected store: AtomicLockStore,
    name: string,
    seconds: number = 0,
    owner?: string
  ) {
    super(name, seconds, owner);
  }

  /**
   * Acquire the lock at the driver level (atomically)
   */
  protected async acquire(): Promise<boolean> {
    return this.store.acquireLock(this.name, this.seconds, this.ownerValue);
  }

  /**
   * Release the lock, but only when still owned by this process
   */
  async release(): Promise<boolean> {
    return this.store.releaseLock(this.name, this.ownerValue);
  }

  /**
   * Release the lock regardless of ownership
   */
  async forceRelease(): Promise<boolean> {
    return this.store.forceReleaseLock(this.name);
  }

  /**
   * Get the current owner of the lock from the store
   */
  protected async getCurrentOwner(): Promise<string | null> {
    return this.store.getLockOwner(this.name);
  }
}
