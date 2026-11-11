/**
 * VerifyCsrfToken middleware
 *
 * Protects unsafe HTTP methods against cross-site request forgery: the
 * request must present the session's CSRF token via the `_token` input,
 * the `X-CSRF-TOKEN` header or the `X-XSRF-TOKEN` header, or the request
 * is rejected with a 419 (Page Expired) response. Safe methods and URIs
 * listed in `csrf.except` (or passed to makeVerifyCsrfToken) pass through,
 * and every answered request gets the readable `XSRF-TOKEN` cookie so JS
 * HTTP clients can send the token back.
 *
 * Laravel: Illuminate\Foundation\Http\Middleware\VerifyCsrfToken
 */

import { timingSafeEqual } from 'crypto';
import type { Middleware } from '@/Routing/Pipeline';
import type { Request } from '@/Routing/Request';
import type { Response } from '@/Routing/Response';
import type { SessionManager } from '@/Session/SessionManager';
import { resolveSessionManager } from '@/Session/Middleware/StartSession';
import { TokenMismatchException } from '@/Session/TokenMismatchException';
import { config } from '@/Support/helpers';
import { Str } from '@/Support/Str';

/**
 * Methods that never mutate state and therefore need no token
 * Laravel: VerifyCsrfToken::isReading()
 */
const READ_METHODS = ['GET', 'HEAD', 'OPTIONS', 'TRACE'];

/**
 * The name of the readable cookie JavaScript clients echo back through the
 * X-XSRF-TOKEN header
 * Laravel: VerifyCsrfToken::$cookieName
 */
export const XSRF_COOKIE_NAME = 'XSRF-TOKEN';

export interface CsrfOptions {
  /** Manager supplying cookie attributes; resolved from the container when omitted */
  manager?: () => SessionManager;
  /** Extra URIs excluded from verification, patterned like csrf.except entries */
  except?: string[];
  /** Override the readable XSRF cookie name */
  cookieName?: string;
}

/**
 * Build a CSRF middleware; the options bind it explicitly, otherwise it
 * reads its exclusions from the `csrf` configuration at request time
 */
export function makeVerifyCsrfToken(options: CsrfOptions = {}): Middleware {
  const middleware: Middleware = (req, res, next) => {
    const session = req.session();
    const token = session.token();

    const passes =
      READ_METHODS.includes(req.method.toUpperCase()) ||
      inExceptArray(req, options.except ?? []) ||
      tokensMatch(req, token);

    if (passes) {
      // Add the readable token cookie on the way out, like Laravel's
      // addCookieToResponse; deferred to header-flush so a token
      // regenerated during the request (login) is the one the client sees
      res.beforeSend(() => {
        addTokenCookie(res, session.token(), options);
      });

      return next();
    }

    throw new TokenMismatchException();
  };

  return middleware;
}

/**
 * The container/config-driven CSRF middleware, ready for the Kernel's
 * global stack or a route group
 * Laravel: Kernel::$middleware[] / the 'web' group
 */
export const VerifyCsrfToken: Middleware = (req, res, next) => makeVerifyCsrfToken()(req, res, next);

/**
 * Determine whether the request path matches an excluded URI pattern
 * Laravel: VerifyCsrfToken::inExceptArray()
 */
function inExceptArray(req: Request, extraExcepts: string[]): boolean {
  let configured: string[] = [];

  try {
    const value = config('csrf.except', []);

    if (Array.isArray(value)) {
      configured = value as string[];
    }
  } catch {
    // No booted application: only the explicitly configured exclusions apply
  }

  const path = req.path.replace(/^\/+/, '');

  return [...configured, ...extraExcepts].some((pattern) => Str.is(pattern.replace(/^\/+/, ''), path));
}

/**
 * Collect the token presented by the request: `_token` input first, then
 * the CSRF headers
 * Laravel: VerifyCsrfToken::getTokenFromRequest()
 */
function tokenFromRequest(req: Request): string | undefined {
  const input = req.input('_token');

  if (typeof input === 'string' && input !== '') {
    return input;
  }

  return req.header('X-CSRF-TOKEN') ?? req.header('X-XSRF-TOKEN');
}

/**
 * Compare the presented token with the session's, in constant time
 * Laravel: hash_equals()
 */
function tokensMatch(req: Request, expected: string): boolean {
  const provided = tokenFromRequest(req);

  if (!provided) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);

  return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);
}

/**
 * Queue the plain-readable XSRF cookie: the session attributes minus
 * HttpOnly, since client scripts must be able to read it
 * Laravel: VerifyCsrfToken::addCookieToResponse()
 */
function addTokenCookie(res: Response, token: string, options: CsrfOptions): void {
  const manager = resolveManager(options);

  if (manager) {
    res.cookie(options.cookieName ?? XSRF_COOKIE_NAME, token, { ...manager.getCookieOptions(), httpOnly: false });
  } else {
    res.cookie(options.cookieName ?? XSRF_COOKIE_NAME, token, { path: '/', sameSite: 'Lax' });
  }
}

/**
 * Resolve the manager for cookie attributes when the app provides one; the
 * CSRF middleware works without it, falling back to safe defaults
 */
function resolveManager(options: CsrfOptions): SessionManager | null {
  if (options.manager) {
    return options.manager();
  }

  try {
    return resolveSessionManager();
  } catch {
    return null;
  }
}
