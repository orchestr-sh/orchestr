/**
 * StartSession middleware
 *
 * Starts the session for the request: builds a store for the configured
 * driver from the ID (or payload) carried by the session cookie, binds it
 * to the Request and the SessionManager, and - just before the response
 * headers are flushed - saves the session and queues the session cookie.
 *
 * Laravel: Illuminate\Session\Middleware\StartSession
 */

import type { Middleware } from '@/Routing/Pipeline';
import { SessionManager } from '@/Session/SessionManager';
import { getGlobalApp } from '@/Support/helpers';

/**
 * Resolve the application's session manager from the container
 */
export function resolveSessionManager(): SessionManager {
  const app = getGlobalApp();

  if (!app) {
    throw new Error('Application not initialized. Call setGlobalApp() first.');
  }

  return app.make<SessionManager>('session');
}

/**
 * Build a session middleware for a specific manager - the seam for testing
 * and for apps that manage their own SessionManager instance
 */
export function makeStartSession(manager: SessionManager): Middleware {
  const middleware: Middleware = (req, res, next) => {
    // An outer pipeline may already have started this request's session
    if (req.hasSession()) {
      return next();
    }

    const session = manager.store(undefined, req.cookie(manager.getCookieName()) ?? null);

    session.start();

    req.setSession(session);
    manager.setCurrent(session);

    // Saving at header-flush time means the persisted payload, the (possibly
    // regenerated) session ID and any flash writes made by the route all
    // reach the response together
    res.beforeSend(() => {
      session.save();
      res.cookie(manager.getCookieName(), session.getCookieValue(), manager.getCookieOptions());
    });

    return next();
  };

  return middleware;
}

/**
 * The container-resolved session middleware, ready for the Kernel's global
 * stack or a route group
 * Laravel: Kernel::$middleware[] / the 'web' group
 */
export const StartSession: Middleware = (req, res, next) => makeStartSession(resolveSessionManager())(req, res, next);
