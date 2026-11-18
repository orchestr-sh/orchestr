/**
 * Broadcasting route helpers
 *
 * The framework half of Laravel's `Broadcast::routes()`: register the channel-
 * authorization endpoint against the application's router, wrapped in the
 * caller's middleware so the connecting request arrives authenticated. Kept
 * separate from the controller (SRP: routing wiring, not request handling) and
 * callable from a routes file or a service provider's boot.
 */

import type { Router } from '@/Routing/Router';
import { BroadcastController } from '@/Broadcasting/BroadcastController';

export interface BroadcastRouteOptions {
  /** Middleware applied to the auth routes (Laravel defaults to `['web']`) */
  middleware?: string | string[];

  /** The channel-auth endpoint path */
  path?: string;

  /** The user-auth endpoint path */
  userPath?: string;
}

/**
 * Register the broadcasting authorization routes.
 * Laravel: Broadcast::routes(['middleware' => ['auth']])
 */
export function registerBroadcastRoutes(router: Router, options: BroadcastRouteOptions = {}): void {
  const middleware = options.middleware ?? 'web';
  const path = options.path ?? '/broadcasting/auth';
  const userPath = options.userPath ?? '/broadcasting/user-auth';

  router.group({ middleware }, () => {
    router.match(['GET', 'POST'], path, [BroadcastController, 'authenticate']);
    router.match(['GET', 'POST'], userPath, [BroadcastController, 'authenticateUser']);
  });
}
