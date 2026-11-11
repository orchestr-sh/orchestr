/**
 * Gate Facade
 *
 * Provides static access to the application's shared authorization gate:
 * ability definitions, policy registrations, before/after overrides and
 * the allows/denies/authorize checks. The gate resolves the current user
 * through the default guard, so checks inside a request answer for the
 * running user.
 *
 * @example
 * ```typescript
 * import { Gate } from '@orchestr-sh/orchestr';
 *
 * Gate.define('update-post', (user, post) => user.getAuthIdentifier() === post.authorId);
 * Gate.policy(Post, PostPolicy);
 * Gate.before((user) => (user as Admin).isSuperAdmin ? true : null);
 *
 * await Gate.allows('update-post', post);            // boolean
 * await Gate.authorize('update-post', post);         // Response or throws (403)
 * await Gate.forUser(null).denies('create', Post);   // guest check
 * ```
 */

import type { Gate as GateService } from '@/Auth/Access/Gate';
import { Facade } from '@/Support/Facade';

class GateFacadeClass extends Facade {
  protected static getFacadeAccessor(): string {
    return 'gate';
  }
}

export const Gate = new Proxy(GateFacadeClass, {
  get(target, prop) {
    // First check if it's a static method on the facade class itself
    if (prop in target) {
      const value = (target as any)[prop];
      if (typeof value === 'function') {
        return value.bind(target);
      }
      return value;
    }

    // Then proxy to the shared gate service
    try {
      const root = (target as any).getFacadeRoot() as GateService;
      if (root && prop in root) {
        const value = (root as any)[prop];
        if (typeof value === 'function') {
          return (...args: any[]) => value.apply(root, args);
        }
        return value;
      }
    } catch (error) {
      // Facade root not available yet
    }

    return undefined;
  },
}) as unknown as typeof GateFacadeClass & GateService;
