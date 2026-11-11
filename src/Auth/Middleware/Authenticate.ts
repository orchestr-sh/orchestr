/**
 * Authenticate middleware ('auth' alias)
 *
 * Guards routes against guests: requests bound to the guard scope pass
 * through when any of the configured guards authenticates a user; guests
 * are answered like Laravel does - a 401 JSON body for requests that expect
 * JSON, otherwise a redirect to the login route.
 *
 * Laravel: Illuminate\Auth\Middleware\Authenticate
 */

import type { AuthManager } from '@/Auth/AuthManager';
import type { Middleware } from '@/Routing/Pipeline';
import type { Request } from '@/Routing/Request';
import { JsonResponse, RedirectResponse } from '@/Routing/Responses';
import { getGlobalApp } from '@/Support/helpers';
import {
  anyGuardAuthenticated,
  configuredRedirect,
  resolveRedirect,
  routeUrl,
  type RedirectDestination,
} from './RedirectResolver';

/**
 * Options for the auth middleware
 */
export interface AuthenticateOptions {
  /**
   * Guards consulted, in order; the request is authenticated when any of
   * them checks in. Defaults to auth.defaults.guard.
   */
  guards?: string[];
  /**
   * Where HTML guests are sent: URL, named route, or callback. Checked
   * before the `auth.redirects.login` config, the 'login' named route and
   * finally '/login'.
   */
  redirectTo?: RedirectDestination;
}

/**
 * Resolve the application's auth manager from the container
 */
export function resolveAuthManager(): AuthManager {
  const app = getGlobalApp();

  if (!app) {
    throw new Error('Application not initialized. Call setGlobalApp() first.');
  }

  return app.make<AuthManager>('auth');
}

/**
 * Build an auth middleware for a specific manager - the seam for testing
 * and for apps that manage their own AuthManager instance
 */
export function makeAuthenticate(manager: AuthManager, options: AuthenticateOptions = {}): Middleware {
  const middleware: Middleware = async (req, res, next) => {
    // Guards read cookies from (and queue the remember cookie onto) this
    // request; forRequest hands the running request its own guard instances
    manager.forRequest(req, res);

    const guards = options.guards ?? [];

    const authenticated = guards.length > 0 ? await anyGuardAuthenticated(manager, guards) : await manager.check();

    if (authenticated) {
      return next();
    }

    if (req.expectsJson()) {
      return new JsonResponse({ message: 'Unauthenticated.' }, 401);
    }

    return new RedirectResponse(guestRedirect(req, options), 302);
  };

  return middleware;
}

/**
 * The container-resolved auth middleware, ready for a route group or an
 * alias
 * Laravel: Kernel::$middlewareAliases['auth']
 */
export const Authenticate: Middleware = (req, res, next) => makeAuthenticate(resolveAuthManager())(req, res, next);

/**
 * The login destination for guests, in Laravel's resolution order
 */
function guestRedirect(request: Request, options: AuthenticateOptions): string {
  const destination = options.redirectTo ?? configuredRedirect('login') ?? routeUrl('login') ?? '/login';

  return resolveRedirect(destination, request);
}
