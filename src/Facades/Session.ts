/**
 * Session Facade
 *
 * Provides static access to the session manager and, for convenience, the
 * session of the current request.
 *
 * @example
 * ```typescript
 * import { Session } from '@orchestr-sh/orchestr';
 *
 * Session.put('user_id', 1);          // on the current request's session
 * const id = Session.get('user_id');
 * Session.flash('status', 'Saved!');
 * Session.regenerate();               // after login: new ID, keep the data
 *
 * // Switch drivers through the manager
 * const guestStore = Session.store('array');
 * ```
 */

import type { Store as SessionStoreContract } from '@/Session/Contracts/Store';
import type { SessionManager } from '@/Session/SessionManager';
import { Facade } from '@/Support/Facade';

class SessionFacadeClass extends Facade {
  protected static getFacadeAccessor(): string {
    return 'session';
  }
}

export const Session = new Proxy(SessionFacadeClass, {
  get(target, prop) {
    // First check if it's a static method on the facade class itself
    if (prop in target) {
      const value = (target as any)[prop];
      if (typeof value === 'function') {
        return value.bind(target);
      }
      return value;
    }

    // Then try to get from the facade root (the SessionManager instance)
    try {
      const root = (target as any).getFacadeRoot() as SessionManager;
      if (root && prop in root) {
        const value = (root as any)[prop];
        if (typeof value === 'function') {
          return (...args: any[]) => value.apply(root, args);
        }
        return value;
      }

      // Also proxy to the current request's session for convenience
      const session = root.current() as SessionStoreContract | null;
      if (session && prop in session) {
        const value = (session as any)[prop];
        if (typeof value === 'function') {
          return (...args: any[]) => value.apply(session, args);
        }
        return value;
      }
    } catch (error) {
      // Facade root not available yet
    }

    return undefined;
  },
}) as unknown as typeof SessionFacadeClass & SessionManager & SessionStoreContract;
