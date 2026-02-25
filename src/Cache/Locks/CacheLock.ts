/**
 * CacheLock
 *
 * Cache store-backed atomic lock implementation.
 * Uses the cache store's add/forget methods for locking.
 *
 * Mirrors Laravel's Illuminate\Cache\CacheLock.
 */

import { Lock } from './Lock';
import type { Store } from '@/Cache/Contracts/Store';

export class CacheLock extends Lock {
  constructor(
    protected store: Store,
    name: string,
    seconds: number = 0,
    owner?: string
  ) {
    super(name, seconds, owner);
  }

  protected async acquire(): Promise<boolean> {
    // Check if already locked
    const existing = await this.store.get(this.name);

    if (existing !== null) {
      // Already locked - check if it's us
      if (existing === this.ownerValue) {
        return true;
      }
      return false;
    }

    // Acquire the lock
    if (this.seconds > 0) {
      return this.store.put(this.name, this.ownerValue, this.seconds);
    }

    return this.store.forever(this.name, this.ownerValue);
  }

  async release(): Promise<boolean> {
    if (await this.isOwnedByCurrentProcess()) {
      return this.store.forget(this.name);
    }
    return false;
  }

  async forceRelease(): Promise<boolean> {
    return this.store.forget(this.name);
  }

  protected async getCurrentOwner(): Promise<string | null> {
    return this.store.get(this.name);
  }
}
