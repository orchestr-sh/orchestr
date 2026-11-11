/**
 * Can middleware ('can' alias)
 *
 * Authorizes the request's user against the shared Gate before the route
 * runs: `can:update,post` checks the 'update' ability with the resolved
 * `:post` route parameter (bound model, explicit binder result, or raw
 * segment) as the argument. Denials throw the AuthorizationException the
 * exception handler renders as a 403, so this middleware never builds the
 * response itself (DRY: one gate, one handler).
 *
 * Additional parameter names are passed as further ability arguments, and a
 * `$name` prefix reads request input instead of a route parameter - like
 * Laravel's `can:update,post,$id`.
 *
 * Laravel: Illuminate\Auth\Middleware\Authorize
 */

import type { Gate } from '@/Auth/Access/Gate';
import type { Middleware } from '@/Routing/Pipeline';
import type { Request } from '@/Routing/Request';
import { resolveGate } from '@/Auth/Access/Gate';

/**
 * Build a can middleware for a specific gate - the seam for testing and
 * for apps carrying their own Gate instance
 */
export function makeCan(gate: Gate): Middleware {
  return async (req, _res, next, ...params) => {
    const [ability, ...parameterNames] = params;

    if (!ability) {
      throw new Error("Middleware 'can' requires an ability, e.g. can:update,post.");
    }

    const args = parameterNames.map((name) => canArgument(req, name));

    await gate.forUser(await req.user()).authorize(ability, args);

    return next();
  };
}

/**
 * The container-resolved can middleware, ready for a route group or an
 * alias
 * Laravel: Kernel::$middlewareAliases['can']
 */
export const Can: Middleware = (req, res, next, ...params) => makeCan(resolveGate())(req, res, next, ...params);

/**
 * One ability argument: request input for a '$name' reference, otherwise
 * the matched route parameter (bound to its model when binding ran). A
 * capitalized name that resolved to nothing is passed through as the
 * model-class reference itself, so `can:create,Post` checks the policy's
 * create method against the Post class like Laravel's
 * `can:create,App\Post`.
 */
function canArgument(req: Request, name: string): any {
  if (name.startsWith('$')) {
    return req.input(name.slice(1));
  }

  const value = req.route(name);

  if (value === undefined && /^[A-Z]/.test(name)) {
    return name;
  }

  return value;
}
