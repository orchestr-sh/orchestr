/**
 * AuthorizationException - thrown whenever a Gate or policy denies an
 * action: `Gate.authorize`, `Request.authorize`, the 'can' middleware and
 * a FormRequest whose `authorize()` refuses.
 *
 * The exception handler maps it onto the 403 AccessDeniedHttpException
 * (carrying an optional custom status from `Response.deny`), so throwing it
 * anywhere in the request lifecycle answers a 403 rather than a 500.
 *
 * Laravel: Illuminate\Auth\Access\AuthorizationException
 */
export class AuthorizationException extends Error {
  /**
   * A custom response status (from `Response.deny(message, status)`), or
   * null when the denial carries the default 403
   */
  public readonly status: number | null;

  constructor(message: string | null = null, status: number | null = null) {
    super(message || 'This action is unauthorized.');
    this.name = 'AuthorizationException';
    this.status = status;

    // Keep instanceof working when the output is down-levelled
    Object.setPrototypeOf(this, AuthorizationException.prototype);
  }

  /**
   * Build the exception with an explicit HTTP status
   * Laravel: AuthorizationException::withStatus()
   */
  static withStatus(message: string | null, status: number): AuthorizationException {
    return new AuthorizationException(message, status);
  }
}
