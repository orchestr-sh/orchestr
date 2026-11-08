/**
 * Global Scope Registry
 *
 * Stores global scopes keyed by the model class that registered them, so the
 * state is per model class rather than one flat global list. Lookup walks the
 * prototype chain from the root down to the concrete class: parent-class scopes
 * apply to subclasses (matching Laravel), and a subclass re-registering an
 * identifier replaces the inherited one.
 */

import { AnyGlobalScope } from './Scope';

/**
 * Counter backing stable identifiers for anonymous closures.
 */
let closureCounter = 0;

export class GlobalScopeRegistry {
  /**
   * Scopes per model class: class -> (identifier -> scope)
   */
  private static scopes: Map<Function, Map<string, AnyGlobalScope>> = new Map();

  /**
   * Derive the identifier a scope is stored under when the caller does not
   * provide one. Scope instances are keyed by class name, closures by their
   * function name or a generated counter.
   */
  static identifierFor(scope: AnyGlobalScope): string {
    if (typeof scope === 'function') {
      closureCounter += 1;
      return scope.name !== '' ? scope.name : `Closure#${closureCounter}`;
    }

    return scope.constructor.name;
  }

  /**
   * Register a scope on a model class under an explicit identifier
   */
  static add(modelClass: Function, identifier: string, scope: AnyGlobalScope): void {
    const registered = this.scopes.get(modelClass) ?? new Map<string, AnyGlobalScope>();
    registered.set(identifier, scope);
    this.scopes.set(modelClass, registered);
  }

  /**
   * Collect the scopes that apply to a model class, walking the prototype
   * chain so subclasses inherit their parents' scopes. Later (more derived)
   * registrations win on identifier collisions.
   */
  static forModel(modelClass: Function): Map<string, AnyGlobalScope> {
    const chain: Function[] = [];

    let ctor: any = modelClass;
    while (typeof ctor === 'function') {
      chain.unshift(ctor);
      ctor = Object.getPrototypeOf(ctor);
    }

    const merged = new Map<string, AnyGlobalScope>();

    for (const cls of chain) {
      for (const [identifier, scope] of this.scopes.get(cls) ?? []) {
        merged.set(identifier, scope);
      }
    }

    return merged;
  }

  /**
   * Remove a scope registered directly on the given class
   */
  static remove(modelClass: Function, identifier: string): void {
    this.scopes.get(modelClass)?.delete(identifier);
  }

  /**
   * Forget scopes: a single class, or every class when omitted. Mostly useful
   * for test isolation; the per-query opt-out is `withoutGlobalScope`.
   */
  static clear(modelClass?: Function): void {
    if (modelClass) {
      this.scopes.delete(modelClass);
    } else {
      this.scopes.clear();
    }
  }
}
