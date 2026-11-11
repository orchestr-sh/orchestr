/**
 * ValidateSignature middleware
 *
 * Guards signed-URL routes: the request must carry a `signature` query
 * parameter that HMAC-matches its URL, and an `expires` parameter (when
 * present) must not have passed. Anything else - a modified query string,
 * a stale link, no signature at all - aborts with a 403, rendered by the
 * shared exception handler.
 *
 * Laravel: Illuminate\Routing\Middleware\ValidateSignature
 *
 * @example
 * ```typescript
 * kernel.middlewareAlias('signed', ValidateSignature);
 *
 * Route.get('/invite/:user', showInvite).middleware('signed');
 *
 * // 30-minute link
 * const url = router.temporarySignedRoute('invite', Math.floor(Date.now() / 1000) + 1800, { user: 1 });
 * ```
 */

import type { Middleware } from '@/Routing/Pipeline';
import type { Router } from '@/Routing/Router';
import { abort } from '@/Foundation/Exceptions/abort';
import { getGlobalApp } from '@/Support/helpers';

/**
 * Resolve the router whose URL generator validates incoming signatures
 */
export function resolveSignedRouter(): Router {
  const app = getGlobalApp();

  if (!app) {
    throw new Error('Application not initialized. Call setGlobalApp() first.');
  }

  return app.make<Router>('router');
}

/**
 * Build a signature middleware; the router factory is the seam for testing
 * and for apps that keep their own Router instance
 */
export function makeValidateSignature(router?: () => Router): Middleware {
  const middleware: Middleware = (req, _res, next) => {
    const target = router ? router() : resolveSignedRouter();

    if (!target.hasValidSignature(req)) {
      abort(403, 'Invalid signature.');
    }

    return next();
  };

  return middleware;
}

/**
 * The container-driven signature middleware, ready for the Kernel's global
 * stack, an alias or a route group
 * Laravel: the 'signed' middleware alias
 */
export const ValidateSignature: Middleware = (req, res, next) => makeValidateSignature()(req, res, next);
