import { HttpException } from './HttpException';

/**
 * AuthenticationException - thrown when the user is not authenticated; the
 * handler renders it as a 401 response
 * Laravel: Illuminate\Auth\AuthenticationException
 */
export class AuthenticationException extends HttpException {
  constructor(message: string = 'Unauthenticated.', headers: Record<string, string> = {}) {
    super(401, message, headers);
    this.name = 'AuthenticationException';

    Object.setPrototypeOf(this, AuthenticationException.prototype);
  }
}
