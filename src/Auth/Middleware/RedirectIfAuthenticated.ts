/**
 * RedirectIfAuthenticated middleware ('guest' alias)
 *
 * The mirror of Authenticate: guests continue through the pipeline while
 * already-authenticated visitors are bounced to the application home, so
 * login screens never show to signed-in users.
 *
 * Laravel: Illuminate\Auth\Middleware\RedirectIfAuthenticated
 */

import type { AuthManager } from '@/Auth/AuthManager';
import type { Middleware } from '@/Routing/Pipeline';
import type { Request } from '@/Routing/Request';
import { RedirectResponse } from '@/Routing/Responses';
import { resolveAuthManager } from './Authenticate';
import {
  anyGuardAuthenticated,
  configuredRedirect,
  resolveRedirect,
  type RedirectDestination,
} from './RedirectResolver';

/**
 * Options for the guest middleware
 */
export interface RedirectIfAuthenticatedOptions {
  /**
   * Guards consulted, in order; a user authenticated on any of them is
   * redirected. Defaults to auth.defaults.guard.
   */
  guards?: string[];
  /**
   * Where authenticated users are sent: URL, named route, or callback.
   * Checked before the `auth.redirects.dashboard` config and finally
   * '/home' (Laravel's RouteServiceProvider::HOME default).
   */
  redirectTo?: RedirectDestination;
}

/**
 * Laravel's default post-login home path
 */
const DEFAULT_HOME = '/home';

/**
 * Build a guest middleware for a specific manager
 */
export function makeRedirectIfAuthenticated(
  manager: AuthManager,
  options: RedirectIfAuthenticatedOptions = {}
): Middleware {
  const middleware: Middleware = async (req, res, next) => {
    manager.forRequest(req, res);

    const guards = options.guards ?? [];

    const authenticated = guards.length > 0 ? await anyGuardAuthenticated(manager, guards) : await manager.check();

    if (authenticated) {
      return new RedirectResponse(homeRedirect(req, options), 302);
    }

    return next();
  };

  return middleware;
}

/**
 * The container-resolved guest middleware
 * Laravel: Kernel::$middlewareAliases['guest']
 */
export const RedirectIfAuthenticated: Middleware = (req, res, next) =>
  makeRedirectIfAuthenticated(resolveAuthManager())(req, res, next);

/**
 * The home destination for authenticated visitors
 */
function homeRedirect(request: Request, options: RedirectIfAuthenticatedOptions): string {
  const destination = options.redirectTo ?? configuredRedirect('dashboard') ?? DEFAULT_HOME;

  return resolveRedirect(destination, request);
}
