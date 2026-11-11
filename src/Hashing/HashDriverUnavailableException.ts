/**
 * HashDriverUnavailableException - raised when a hashing driver depends on
 * an optional peer dependency (bcrypt, argon2) that the application has not
 * installed; the message names the exact package to add, so the failure is
 * actionable rather than a bare module-not-found
 * Laravel: the "The required bcrypt library was not found." RuntimeException
 */
export class HashDriverUnavailableException extends Error {
  constructor(packageName: string, driverName: string, cause?: unknown) {
    super(
      `The "${driverName}" hashing driver requires the optional "${packageName}" package, ` +
        `which is not installed. Add it with "npm install ${packageName}".`,
      cause === undefined ? undefined : { cause }
    );
    this.name = 'HashDriverUnavailableException';

    // Keep instanceof working when the output is down-levelled
    Object.setPrototypeOf(this, HashDriverUnavailableException.prototype);
  }
}
