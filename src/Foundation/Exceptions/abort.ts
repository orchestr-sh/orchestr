import { AccessDeniedHttpException } from './AccessDeniedHttpException';
import { AuthenticationException } from './AuthenticationException';
import { HttpException } from './HttpException';
import { NotFoundHttpException } from './NotFoundHttpException';

/**
 * Abort the request with the given HTTP status code; the exception handler
 * renders the thrown exception into the response
 * Laravel: abort($code, $message, $headers)
 *
 * Statuses with a dedicated exception class get the matching one (401 ->
 * AuthenticationException, 403 -> AccessDeniedHttpException, 404 ->
 * NotFoundHttpException); every other status raises a plain HttpException.
 */
export function abort(status: number, message: string = '', headers: Record<string, string> = {}): never {
  switch (status) {
    case 401:
      throw new AuthenticationException(message || 'Unauthenticated.', headers);
    case 403:
      throw new AccessDeniedHttpException(message, headers);
    case 404:
      throw new NotFoundHttpException(message, headers);
    default:
      throw new HttpException(status, message, headers);
  }
}

/**
 * Abort the request if the given condition is truthy
 * Laravel: abort_if($condition, $code, $message, $headers)
 */
export function abort_if(
  condition: unknown,
  status: number,
  message: string = '',
  headers: Record<string, string> = {}
): void {
  if (condition) {
    abort(status, message, headers);
  }
}

/**
 * Abort the request unless the given condition is truthy
 * Laravel: abort_unless($condition, $code, $message, $headers)
 */
export function abort_unless(
  condition: unknown,
  status: number,
  message: string = '',
  headers: Record<string, string> = {}
): void {
  if (!condition) {
    abort(status, message, headers);
  }
}
