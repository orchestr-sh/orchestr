/**
 * TokenMismatchException - raised by the CSRF middleware when a mutating
 * request does not carry the session's CSRF token; the exception handler
 * renders it as the 419 (Page Expired) response
 * Laravel: Illuminate\Session\TokenMismatchException
 */

import { HttpException } from '@/Foundation/Exceptions/HttpException';

export class TokenMismatchException extends HttpException {
  constructor(message: string = 'CSRF token mismatch.', headers: Record<string, string> = {}) {
    super(419, message, headers);
    this.name = 'TokenMismatchException';

    // Keep instanceof working when the output is down-levelled
    Object.setPrototypeOf(this, TokenMismatchException.prototype);
  }
}
