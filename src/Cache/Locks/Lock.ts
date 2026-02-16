/**
 * Lock Base Class
 *
 * Abstract base class for atomic lock implementations.
 * Provides the shared logic for acquiring, blocking, and releasing locks.
 *
 * Mirrors Laravel's Illuminate\Cache\Lock.
 */

import { randomUUID } from 'crypto';
import type { LockContract } from '../Contracts/Lock';
import { LockTimeoutException } from './LockTimeoutException';

export abstract class Lock implements LockContract {
  protected ownerValue: string;

  constructor(
    protected name: string,
    protected seconds: number = 0,
    owner?: string
  ) {
    this.ownerValue = owner || randomUUID();
  }

  /**
   * Attempt to acquire the lock at the driver level
   */
  protected abstract acquire(): Promise<boolean>;

  /**
   * Release the lock at the driver level
   */
  abstract release(): Promise<boolean>;

  /**
   * Force release the lock regardless of ownership
   */
  abstract forceRelease(): Promise<boolean>;

  /**
   * Get the current owner of the lock from the store
   */
  protected abstract getCurrentOwner(): Promise<string | null>;

  /**
   * Attempt to acquire the lock.
   * If a callback is provided, execute it and auto-release.
   */
  async get(callback?: () => Promise<any> | any): Promise<boolean | any> {
    const acquired = await this.acquire();

    if (!acquired) {
      return false;
    }

    if (callback) {
      try {
        return await callback();
      } finally {
        await this.release();
      }
    }

    return true;
  }

  /**
   * Block until the lock is acquired or timeout expires.
   * If a callback is provided, execute it and auto-release.
   */
  async block(seconds: number, callback?: () => Promise<any> | any): Promise<boolean | any> {
    const startTime = Date.now();
    const timeoutMs = seconds * 1000;

    while (Date.now() - startTime < timeoutMs) {
      if (await this.acquire()) {
        if (callback) {
          try {
            return await callback();
          } finally {
            await this.release();
          }
        }
        return true;
      }

      await this.sleep(250);
    }

    throw new LockTimeoutException(
      `Unable to acquire lock [${this.name}] within ${seconds} second(s).`
    );
  }

  /**
   * Returns the lock owner identifier
   */
  owner(): string {
    return this.ownerValue;
  }

  /**
   * Check if the lock is owned by the current process
   */
  async isOwnedByCurrentProcess(): Promise<boolean> {
    const currentOwner = await this.getCurrentOwner();
    return currentOwner === this.ownerValue;
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
