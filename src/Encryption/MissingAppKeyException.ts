/**
 * MissingAppKeyException - raised when encryption or URL signing is asked
 * to run without an application key configured
 * Laravel: Illuminate\Contracts\Encryption\MissingAppKeyException
 */
export class MissingAppKeyException extends Error {
  constructor(message: string = 'No application encryption key has been specified.') {
    super(message);
    this.name = 'MissingAppKeyException';

    // Keep instanceof working when the output is down-levelled
    Object.setPrototypeOf(this, MissingAppKeyException.prototype);
  }
}
