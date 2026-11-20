import type { Abstract, Binding } from './types';

/**
 * Binding storage for the container: the registered bindings, cached
 * shared instances, alias chains, resolved-type marks, and tags.
 *
 * Pure state - resolution, contextual lookup, and callback firing all
 * live in their own collaborators. Keeping storage here lets `Container`
 * stay focused on the resolution pipeline.
 */
export class BindingRegistry {
  private bindings: Map<Abstract, Binding> = new Map();
  private instances: Map<Abstract, any> = new Map();
  private aliases: Map<Abstract, Abstract> = new Map();
  private resolvedTypes: Set<Abstract> = new Set();
  private tags: Map<string, Abstract[]> = new Map();

  // -------------------------------------------------------------------------
  // Bindings
  // -------------------------------------------------------------------------

  setBinding(abstract: Abstract, binding: Binding): void {
    this.bindings.set(abstract, binding);
  }

  getBinding(abstract: Abstract): Binding | undefined {
    return this.bindings.get(abstract);
  }

  // -------------------------------------------------------------------------
  // Shared instances
  // -------------------------------------------------------------------------

  hasInstance(abstract: Abstract): boolean {
    return this.instances.has(abstract);
  }

  getInstance(abstract: Abstract): any {
    return this.instances.get(abstract);
  }

  setInstance(abstract: Abstract, instance: any): void {
    this.instances.set(abstract, instance);
  }

  deleteInstance(abstract: Abstract): void {
    this.instances.delete(abstract);
  }

  clearInstances(): void {
    this.instances.clear();
  }

  /** Every abstract whose binding was registered through `scoped()` */
  scopedAbstracts(): Abstract[] {
    const scoped: Abstract[] = [];

    for (const [abstract, binding] of this.bindings) {
      if (binding.scoped) {
        scoped.push(abstract);
      }
    }

    return scoped;
  }

  // -------------------------------------------------------------------------
  // Aliases
  // -------------------------------------------------------------------------

  setAlias(abstract: Abstract, alias: Abstract): void {
    this.aliases.set(alias, abstract);
  }

  /** Drop any alias registered under the given name */
  forgetAlias(alias: Abstract): void {
    this.aliases.delete(alias);
  }

  /**
   * Get the real abstract if an alias is given, following chained
   * aliases to their target.
   */
  getAlias(abstract: Abstract): Abstract {
    return this.aliases.has(abstract) ? this.getAlias(this.aliases.get(abstract)!) : abstract;
  }

  isAlias(abstract: Abstract): boolean {
    return this.aliases.has(abstract);
  }

  // -------------------------------------------------------------------------
  // Resolved marks
  // -------------------------------------------------------------------------

  markResolved(abstract: Abstract): void {
    this.resolvedTypes.add(abstract);
  }

  deleteResolved(abstract: Abstract): void {
    this.resolvedTypes.delete(abstract);
  }

  hasResolved(abstract: Abstract): boolean {
    return this.resolvedTypes.has(abstract);
  }

  // -------------------------------------------------------------------------
  // Tags
  // -------------------------------------------------------------------------

  tag(tag: string, abstracts: Abstract[]): void {
    const existing = this.tags.get(tag) ?? [];

    this.tags.set(tag, existing.concat(abstracts));
  }

  tagged(tag: string): Abstract[] | undefined {
    return this.tags.get(tag);
  }

  // -------------------------------------------------------------------------
  // Queries & lifecycle
  // -------------------------------------------------------------------------

  isBound(abstract: Abstract): boolean {
    return this.bindings.has(abstract) || this.instances.has(abstract) || this.aliases.has(abstract);
  }

  isResolved(abstract: Abstract): boolean {
    return this.resolvedTypes.has(abstract) || this.instances.has(abstract);
  }

  /**
   * Drop the cached instance for an abstract so a fresh binding takes
   * effect immediately (Laravel's `dropStaleInstances`). The resolved
   * mark is handled by `Container.bind()` itself, matching the
   * container's historic non-shared rebind semantics.
   */
  dropStaleInstances(abstract: Abstract): void {
    this.instances.delete(abstract);
  }

  /**
   * Clear every registration except tags and the lifecycle callback
   * registries, mirroring Laravel's `flush()`.
   */
  flush(): void {
    this.bindings.clear();
    this.instances.clear();
    this.aliases.clear();
    this.resolvedTypes.clear();
  }
}
