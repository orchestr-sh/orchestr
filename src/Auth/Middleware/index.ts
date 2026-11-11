/**
 * Auth Middleware
 *
 * Route-level guards: 'auth' blocks guests (401 JSON or a login redirect)
 * and 'guest' sends authenticated users home.
 */

export { Authenticate, makeAuthenticate, resolveAuthManager, type AuthenticateOptions } from './Authenticate';
export {
  RedirectIfAuthenticated,
  makeRedirectIfAuthenticated,
  type RedirectIfAuthenticatedOptions,
} from './RedirectIfAuthenticated';
export { resolveRedirect, type RedirectDestination } from './RedirectResolver';
