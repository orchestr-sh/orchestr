/**
 * Redirect target resolution shared by the authentication middleware (DRY).
 *
 * A destination may be a literal URL, a named route, or a callback; the
 * string `/path` and `http(s)://` forms are taken as-is, bare names are
 * expanded through the router's named routes (Laravel's `route('login')`)
 * and anything unresolvable degrades to a path so the app keeps answering
 * redirects instead of throwing inside middleware.
 */

import type { AuthManager } from '@/Auth/AuthManager';
import type { Request } from '@/Routing/Request';
import { getGlobalApp } from '@/Support/helpers';

/**
 * A redirect destination: a URL path, a named route, or a callback
 */
export type RedirectDestination = string | ((request: Request) => string);

/**
 * Resolve a redirect destination against the running request
 */
export function resolveRedirect(destination: RedirectDestination, request: Request): string {
  if (typeof destination === 'function') {
    return destination(request);
  }

  if (destination.startsWith('/') || destination.startsWith('http://') || destination.startsWith('https://')) {
    return destination;
  }

  return routeUrl(destination) ?? `/${destination}`;
}

/**
 * Read a redirect override from the `auth.redirects.*` config section,
 * honouring the same destination forms
 */
export function configuredRedirect(key: string): RedirectDestination | null {
  const app = getGlobalApp();

  if (!app || !app.bound('config')) {
    return null;
  }

  try {
    const value = app.make<{ get(key: string, defaultValue?: any): any }>('config').get(`auth.redirects.${key}`);

    if (typeof value === 'string' || typeof value === 'function') {
      return value;
    }
  } catch {
    // Config repository not resolvable; fall back to defaults
  }

  return null;
}

/**
 * Determine whether any of the named guards has an authenticated user
 * (shared by the auth and guest middleware, DRY)
 * Laravel: Authenticate::authenticate() / RedirectIfAuthenticated::handle()
 */
export async function anyGuardAuthenticated(manager: AuthManager, guards: string[]): Promise<boolean> {
  for (const guard of guards) {
    if (await manager.guard(guard).check()) {
      return true;
    }
  }

  return false;
}

/**
 * The URL of a named route, or null when the router (or the name) is not
 * registered
 */
export function routeUrl(name: string): string | null {
  const app = getGlobalApp();

  if (!app || !app.bound('router')) {
    return null;
  }

  try {
    return app.make<{ url(name: string, parameters?: any): string }>('router').url(name);
  } catch {
    return null;
  }
}
