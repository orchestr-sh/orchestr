/**
 * LockTimeoutException
 *
 * Thrown when a lock cannot be acquired within the specified timeout.
 */
export class LockTimeoutException extends Error {
  constructor(message: string = 'Unable to acquire lock.') {
    super(message);
    this.name = 'LockTimeoutException';
  }
}
