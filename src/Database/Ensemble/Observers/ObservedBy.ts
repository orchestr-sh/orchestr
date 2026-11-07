/**
 * ObservedBy Decorator
 *
 * Class decorator that binds observers to a model, the annotation alternative
 * to calling `Model.observe()` by hand.
 *
 * @param observers Observer classes (or instances) to register
 * @returns Class decorator function
 *
 * @example
 * ```typescript
 * import { Ensemble, ObservedBy } from '@orchestr-sh/orchestr';
 *
 * class UserObserver {
 *   creating(user: Ensemble) {
 *     // ...
 *   }
 * }
 *
 * @ObservedBy(UserObserver)
 * class User extends Ensemble {
 *   // ...
 * }
 *
 * // Several observers at once
 * @ObservedBy(UserObserver, AuditObserver)
 * class AuditedUser extends Ensemble {}
 * ```
 */

import { ObserverRegistration, ObserverRegistry } from './ObserverRegistry';

export function ObservedBy(...observers: ObserverRegistration[]): ClassDecorator {
  return function (target: any) {
    for (const observer of observers) {
      ObserverRegistry.observe(target, observer);
    }

    return target;
  };
}
