/**
 * DecryptException - raised when a payload cannot be authenticated or
 * decoded: it was tampered with, produced by another key, or is not a
 * payload at all
 * Laravel: Illuminate\Contracts\Encryption\DecryptException
 */
export class DecryptException extends Error {
  constructor(message: string = 'The payload is invalid.', options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'DecryptException';

    // Keep instanceof working when the output is down-levelled
    Object.setPrototypeOf(this, DecryptException.prototype);
  }
}
