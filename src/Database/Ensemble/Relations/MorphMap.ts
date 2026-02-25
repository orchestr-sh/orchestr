/**
 * MorphMap
 *
 * Global morph map for polymorphic relations
 * Maps aliases to model classes for cleaner database storage
 */

import { Ensemble } from '@/Database/Ensemble/Ensemble';

export class MorphMap {
  /**
   * Map from alias to model class
   */
  private static map: Map<string, new () => Ensemble> = new Map();

  /**
   * Reverse map from model class to alias
   */
  private static reverseMap: Map<new () => Ensemble, string> = new Map();

  /**
   * Set the morph map
   *
   * @example
   * MorphMap.set({
   *   'post': Post,
   *   'video': Video,
   *   'comment': Comment
   * });
   */
  static set(map: Record<string, new () => Ensemble>): void {
    this.map.clear();
    this.reverseMap.clear();

    for (const [alias, modelClass] of Object.entries(map)) {
      this.map.set(alias, modelClass);
      this.reverseMap.set(modelClass, alias);
    }
  }

  /**
   * Get model class from alias
   */
  static getClass(alias: string): (new () => Ensemble) | undefined {
    return this.map.get(alias);
  }

  /**
   * Get alias from model class
   * Returns the class name if no alias is defined
   */
  static getAlias(modelClass: new () => Ensemble): string {
    return this.reverseMap.get(modelClass) || modelClass.name;
  }

  /**
   * Get the morph type for a model instance
   * This is what gets stored in the database {name}_type column
   */
  static getMorphedModel(instance: Ensemble): string {
    return this.getAlias(instance.constructor as new () => Ensemble);
  }

  /**
   * Clear the morph map
   */
  static clear(): void {
    this.map.clear();
    this.reverseMap.clear();
  }

  /**
   * Check if an alias exists in the map
   */
  static has(alias: string): boolean {
    return this.map.has(alias);
  }

  /**
   * Get all registered aliases
   */
  static aliases(): string[] {
    return Array.from(this.map.keys());
  }

  /**
   * Get all registered model classes
   */
  static classes(): (new () => Ensemble)[] {
    return Array.from(this.map.values());
  }
}
