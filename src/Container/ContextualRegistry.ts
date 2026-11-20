import type { Abstract } from './types';

/**
 * Storage and lookup for contextual bindings registered through
 * `Container.when(...).needs(...).give(...)`.
 *
 * The map is keyed by the *consumer* being built (the abstract whose
 * dependency should be substituted) and then by the dependency itself.
 * Lookups happen while a build is in progress, so the container hands in
 * the top of its build stack; outside a build there is no consumer and
 * contextual bindings never apply.
 */
export class ContextualRegistry {
  private bindings: Map<Abstract, Map<Abstract, any>> = new Map();

  set(consumer: Abstract, dependency: Abstract, implementation: any): void {
    let dependencies = this.bindings.get(consumer);

    if (!dependencies) {
      dependencies = new Map();
      this.bindings.set(consumer, dependencies);
    }

    dependencies.set(dependency, implementation);
  }

  /**
   * Find the contextual implementation registered for `dependency` while
   * `consumer` is being built.
   *
   * Consumers may be registered as classes or as names: when the stack
   * holds a class whose `name` was used as the key, the name entry still
   * matches (Laravel keys these by class-string; TypeScript keeps the
   * class itself in hand, so both spellings are honoured).
   */
  find(consumer: Abstract | undefined, dependency: Abstract): any {
    if (consumer === undefined) {
      return undefined;
    }

    const dependencies = this.dependenciesFor(consumer);

    if (!dependencies) {
      return undefined;
    }

    let implementation = dependencies.get(dependency);

    if (implementation === undefined && typeof dependency === 'function') {
      // Dependency names registered as strings, e.g. needs('logger')
      implementation = dependencies.get(dependency.name);
    }

    return implementation;
  }

  private dependenciesFor(consumer: Abstract): Map<Abstract, any> | undefined {
    const direct = this.bindings.get(consumer);

    if (direct) {
      return direct;
    }

    if (typeof consumer === 'function') {
      return this.bindings.get(consumer.name);
    }

    return undefined;
  }
}
