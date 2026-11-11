/**
 * Auth Middleware
 *
 * Route-level guards: 'auth' blocks guests (401 JSON or a login redirect),
 * 'guest' sends authenticated users home and 'can' authorizes the request's
 * user against the shared Gate (403 on denial).
 */

export { Authenticate, makeAuthenticate, resolveAuthManager, type AuthenticateOptions } from './Authenticate';
export { Can, makeCan } from './Can';
export {
  RedirectIfAuthenticated,
  makeRedirectIfAuthenticated,
  type RedirectIfAuthenticatedOptions,
} from './RedirectIfAuthenticated';
export { resolveRedirect, type RedirectDestination } from './RedirectResolver';
