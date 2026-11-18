import type { Container } from './Container';
import type { Abstract, Extender, RebindingCallback, ResolvingCallback } from './types';

/**
 * Registry for the container's lifecycle callbacks: extension closures,
 * rebinding listeners, and resolving/afterResolving hooks.
 *
 * Callbacks registered against a class also fire when a subclass instance
 * is resolved (Laravel's `getCallbacksForType`), while string/symbol keys
 * match the resolved abstract exactly.
 */
export class LifecycleHooks {
  private extenders: Map<Abstract, Extender[]> = new Map();
  private reboundCallbacks: Map<Abstract, RebindingCallback[]> = new Map();
  private resolvingCallbacks: Map<Abstract, ResolvingCallback[]> = new Map();
  private afterResolvingCallbacks: Map<Abstract, ResolvingCallback[]> = new Map();

  // -------------------------------------------------------------------------
  // Extension (decoration)
  // -------------------------------------------------------------------------

  addExtender(abstract: Abstract, extension: Extender): void {
    const existing = this.extenders.get(abstract) ?? [];

    existing.push(extension);
    this.extenders.set(abstract, existing);
  }

  /** Apply every registered extension in registration order */
  applyExtenders(abstract: Abstract, instance: any, container: Container): any {
    let object = instance;

    for (const extension of this.extenders.get(abstract) ?? []) {
      object = extension(object, container);
    }

    return object;
  }

  forgetExtenders(abstract: Abstract): void {
    this.extenders.delete(abstract);
  }

  // -------------------------------------------------------------------------
  // Rebinding
  // -------------------------------------------------------------------------

  addReboundCallback(abstract: Abstract, callback: RebindingCallback): void {
    const existing = this.reboundCallbacks.get(abstract) ?? [];

    existing.push(callback);
    this.reboundCallbacks.set(abstract, existing);
  }

  reboundCallbacksFor(abstract: Abstract): RebindingCallback[] {
    return this.reboundCallbacks.get(abstract) ?? [];
  }

  // -------------------------------------------------------------------------
  // Resolving hooks
  // -------------------------------------------------------------------------

  addResolvingCallback(abstract: Abstract, callback: ResolvingCallback): void {
    LifecycleHooks.push(this.resolvingCallbacks, abstract, callback);
  }

  addAfterResolvingCallback(abstract: Abstract, callback: ResolvingCallback): void {
    LifecycleHooks.push(this.afterResolvingCallbacks, abstract, callback);
  }

  /**
   * Fire `resolving` then `afterResolving` for a freshly built instance.
   * Cached-instance returns never re-fire, matching Laravel.
   */
  fireResolvingCallbacks(abstract: Abstract, object: any, container: Container): void {
    for (const callback of LifecycleHooks.matching(this.resolvingCallbacks, abstract, object)) {
      callback(object, container);
    }

    for (const callback of LifecycleHooks.matching(this.afterResolvingCallbacks, abstract, object)) {
      callback(object, container);
    }
  }

  private static push(map: Map<Abstract, ResolvingCallback[]>, abstract: Abstract, callback: ResolvingCallback): void {
    const existing = map.get(abstract) ?? [];

    existing.push(callback);
    map.set(abstract, existing);
  }

  private static matching(
    map: Map<Abstract, ResolvingCallback[]>,
    abstract: Abstract,
    object: any
  ): ResolvingCallback[] {
    const matches: ResolvingCallback[] = [];

    for (const [key, callbacks] of map) {
      if (key === '*' || key === abstract || LifecycleHooks.instanceMatches(key, object)) {
        matches.push(...callbacks);
      }
    }

    return matches;
  }

  private static instanceMatches(key: Abstract, object: any): boolean {
    return (
      typeof key === 'function' &&
      key.prototype !== undefined &&
      object !== null &&
      typeof object === 'object' &&
      object instanceof (key as any)
    );
  }
}
