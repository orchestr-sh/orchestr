import { HttpException } from './HttpException';

/**
 * AccessDeniedHttpException - the 403 thrown when authorization fails, e.g.
 * a FormRequest whose authorize() returns false
 * Laravel: Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException
 */
export class AccessDeniedHttpException extends HttpException {
  constructor(message: string = 'This action is unauthorized.', headers: Record<string, string> = {}) {
    super(403, message, headers);
    this.name = 'AccessDeniedHttpException';

    Object.setPrototypeOf(this, AccessDeniedHttpException.prototype);
  }
}
