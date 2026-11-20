import type { Container } from './Container';
import type { Abstract } from './types';

/**
 * Fluent half of a contextual binding: `when(consumer).needs(dependency).give(...)`.
 *
 * Mirrors Laravel's `Illuminate\Container\ContextualBindingBuilder`, with
 * `giveConfig` modelled on the framework-level container: the value is
 * read from the container's `config` binding at resolution time.
 */
export class ContextualBindingBuilder {
  private consumers: Abstract[];
  private dependencies: Abstract[] = [];

  constructor(
    private container: Container,
    consumers: Abstract[]
  ) {
    this.consumers = consumers;
  }

  /**
   * The dependency (constructor parameter or `call()` argument) the
   * following `give*` methods substitute. Also accepts `'$name'` strings
   * for primitives, like Laravel.
   */
  needs(dependency: Abstract | Abstract[]): this {
    this.dependencies = this.dependencies.concat(ContextualBindingBuilder.wrap(dependency));

    return this;
  }

  /**
   * Register the contextual implementation for every consumer/dependency
   * pair. The implementation may be a class, a factory closure receiving
   * the container, or any literal value.
   */
  give(implementation: any): this {
    for (const consumer of this.consumers) {
      for (const dependency of this.dependencies) {
        this.container.addContextualBinding(consumer, dependency, implementation);
      }
    }

    return this;
  }

  /**
   * Give every service registered under `tag` (Laravel's `giveTagged`).
   */
  giveTagged(tag: string): this {
    return this.give((container: Container) => container.tagged(tag));
  }

  /**
   * Give the configuration value stored at `key`, read from the
   * container's `config` binding at resolution time.
   */
  giveConfig(key: string): this {
    return this.give((container: Container) => {
      const config = container.make<{ get: (key: string, defaultValue?: any) => any }>('config');

      if (typeof config?.get !== 'function') {
        throw new Error(`Contextual config binding [${key}] requires the 'config' binding to expose get().`);
      }

      return config.get(key);
    });
  }

  private static wrap(value: Abstract | Abstract[]): Abstract[] {
    return Array.isArray(value) ? value : [value];
  }
}
