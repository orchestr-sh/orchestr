import { HttpException } from './HttpException';

/**
 * ThrottleRequestsException - the 429 raised when a rate limit window is
 * exhausted
 * Laravel: Illuminate\Http\Exceptions\ThrottleRequestsException (backed by
 * Symfony's TooManyRequestsHttpException)
 *
 * The Retry-After and X-RateLimit-* headers are attached here so the shared
 * exception handler keeps them on the rendered response - JSON or HTML,
 * whichever the request negotiates.
 */
export class ThrottleRequestsException extends HttpException {
  constructor(message: string = 'Too Many Attempts.', headers: Record<string, string> = {}) {
    super(429, message, headers);
    this.name = 'ThrottleRequestsException';

    // Keep instanceof working when the output is down-levelled
    Object.setPrototypeOf(this, ThrottleRequestsException.prototype);
  }
}
