/**
 * CacheLock
 *
 * Cache store-backed lock implementation. Uses the store's atomic
 * `add()` when the driver provides it (array, redis) and otherwise falls
 * back to a read-then-write acquire.
 *
 * Mirrors Laravel's Illuminate\Cache\CacheLock.
 */

import type { Store } from '@/Cache/Contracts/Store';
import { Lock } from './Lock';

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
    if (typeof this.store.add === 'function') {
      // Single check-and-set round trip: two processes can never both
      // claim the lock.
      if (await this.store.add(this.name, this.ownerValue, this.seconds)) {
        return true;
      }

      // The lock exists - it is only still ours when the stored owner
      // matches.
      return (await this.store.get(this.name)) === this.ownerValue;
    }

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
