/**
 * Lock Contract
 *
 * Defines the interface for atomic lock implementations.
 * Mirrors Laravel's Illuminate\Contracts\Cache\Lock.
 */
export interface LockContract {
  /**
   * Attempt to acquire the lock.
   * If a callback is provided, it will be executed and the lock released automatically.
   */
  get(callback?: () => Promise<any> | any): Promise<boolean | any>;

  /**
   * Attempt to acquire the lock for the given number of seconds.
   * Blocks until the lock is acquired or the timeout is reached.
   */
  block(seconds: number, callback?: () => Promise<any> | any): Promise<boolean | any>;

  /**
   * Release the lock
   */
  release(): Promise<boolean>;

  /**
   * Returns the current owner of the lock
   */
  owner(): string;

  /**
   * Releases this lock regardless of ownership
   */
  forceRelease(): Promise<boolean>;
}
