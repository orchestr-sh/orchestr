/**
 * EnsureEmailIsVerified middleware ('verified' alias)
 *
 * The mirror of Authenticate for the email-verification flow: guests get
 * the usual 401-JSON-or-login-redirect, verified users pass through, and
 * authenticated-but-unverified visitors are blocked - a 403 with a
 * translated message for requests expecting JSON, otherwise a redirect to
 * the `verification.notice` route (Laravel's `route('verification.notice')`
 * fallback chain, '/email/verify' when no app has named it).
 *
 * Laravel: Illuminate\Auth\Middleware\EnsureEmailIsVerified
 *
 * @example
 * ```typescript
 * // the AuthServiceProvider ships the 'verified' alias on boot
 * router.get('/dashboard', show).middleware('verified');
 *
 * // or with an explicit manager / guard / redirect
 * router.get('/billing', show).middleware(makeEnsureEmailIsVerified(manager, { guard: 'web' }));
 * ```
 */

import type { AuthManager } from '@/Auth/AuthManager';
import type { Middleware } from '@/Routing/Pipeline';
import type { Request } from '@/Routing/Request';
import { resolveAuthManager } from '@/Auth/Middleware/Authenticate';
import {
  configuredRedirect,
  resolveRedirect,
  routeUrl,
  type RedirectDestination,
} from '@/Auth/Middleware/RedirectResolver';
import { JsonResponse, RedirectResponse } from '@/Routing/Responses';

/**
 * Options for the verified middleware
 */
export interface EnsureEmailIsVerifiedOptions {
  /**
   * Guard consulted for the user; defaults to auth.defaults.guard.
   */
  guard?: string;

  /**
   * Where unverified HTML visitors are sent: URL, named route, or
   * callback. Checked before `auth.redirects.verification`, the
   * 'verification.notice' named route and finally '/email/verify'.
   */
  redirectTo?: RedirectDestination;
}

/**
 * The message unverified requests hear (Laravel: 'Please confirm your email
 * address to continue.')
 */
export const VERIFICATION_MESSAGE = 'Please confirm your email address to continue.';

/**
 * Build a verified middleware for a specific manager - the seam for
 * testing and for apps that manage their own AuthManager instance.
 */
export function makeEnsureEmailIsVerified(
  manager: AuthManager,
  options: EnsureEmailIsVerifiedOptions = {}
): Middleware {
  const middleware: Middleware = async (req, res, next) => {
    // Guards read cookies from (and queue the remember cookie onto) this
    // request; forRequest hands the running request its own guard instances
    manager.forRequest(req, res);

    const user = await manager.guard(options.guard).user();

    if (!user) {
      if (req.expectsJson()) {
        return new JsonResponse({ message: 'Unauthenticated.' }, 401);
      }

      return new RedirectResponse(loginRedirect(req), 302);
    }

    if (typeof (user as any).hasVerifiedEmail !== 'function') {
      throw new Error(
        'The authenticated user cannot be verified: compose the model with the HasVerifiedEmail ' +
          'concern (or implement the MustVerifyEmail contract) before using the verified middleware.'
      );
    }

    if (await (user as any).hasVerifiedEmail()) {
      return next();
    }

    if (req.expectsJson()) {
      return new JsonResponse({ message: VERIFICATION_MESSAGE }, 403);
    }

    return new RedirectResponse(verificationRedirect(req, options), 302);
  };

  return middleware;
}

/**
 * The container-resolved verified middleware, ready for the 'verified'
 * alias, a route group or the Kernel's global stack.
 * Laravel: Kernel::$middlewareAliases['verified']
 */
export const EnsureEmailIsVerified: Middleware = (req, res, next) =>
  makeEnsureEmailIsVerified(resolveAuthManager())(req, res, next);

/**
 * The login destination for guests, in Laravel's resolution order (shared
 * with the auth middleware, DRY).
 */
function loginRedirect(request: Request): string {
  const destination = configuredRedirect('login') ?? routeUrl('login') ?? '/login';

  return resolveRedirect(destination, request);
}

/**
 * The verification notice destination for unverified visitors, in
 * Laravel's resolution order.
 */
function verificationRedirect(request: Request, options: EnsureEmailIsVerifiedOptions): string {
  const destination =
    options.redirectTo ?? configuredRedirect('verification') ?? routeUrl('verification.notice') ?? '/email/verify';

  return resolveRedirect(destination, request);
}
