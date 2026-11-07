/**
 * EnsembleCollection Class
 *
 * A collection of Ensemble models. All generic collection behaviour is
 * inherited from the framework's Support Collection; only model-specific
 * helpers live here. Methods that return new collections preserve this
 * concrete class at runtime.
 */

import { Collection } from '@/Support/Collection';
import { Ensemble } from './Ensemble';

export class EnsembleCollection<T extends Ensemble> extends Collection<T> {
  /**
   * Create a new collection
   */
  constructor(items: T[] = []) {
    super(items);
  }

  /**
   * Get the collection of items as a plain array
   */
  toArray(): Record<string, any>[] {
    return this.map((item) => (item && typeof item.toObject === 'function' ? item.toObject() : item)).all() as Record<
      string,
      any
    >[];
  }

  /**
   * Map the collection into a plain array of arbitrary values
   */
  mapIntoCollection<U>(callback: (item: T, index: number) => U): U[] {
    return this.map((item, key) => callback(item, Number(key))).all();
  }

  /**
   * Get the keys of the collection items
   */
  modelKeys(): any[] {
    return this.map((item) => item.getKey()).all();
  }

  /**
   * Chunk the collection into smaller collections of models
   */
  chunkModels(size: number): EnsembleCollection<T>[] {
    return this.chunk(size).all() as EnsembleCollection<T>[];
  }

  /**
   * Get the collection without the specified model keys
   */
  except(keys: any[]): EnsembleCollection<T> {
    const keySet = new Set(keys);

    return this.filter((item) => !keySet.has(item.getKey())) as unknown as EnsembleCollection<T>;
  }

  /**
   * Get only the specified models from the collection
   */
  only(keys: any[]): EnsembleCollection<T> {
    const keySet = new Set(keys);

    return this.filter((item) => keySet.has(item.getKey())) as unknown as EnsembleCollection<T>;
  }

  /**
   * Load a set of relationships onto the collection
   */
  async load(relations: string | string[]): Promise<this> {
    // TODO: Implement eager loading
    // This will be implemented when we add relationship support
    return this;
  }

  /**
   * Find a model in the collection by key
   */
  find(keyOrCallback: any | ((item: T) => boolean)): T | undefined {
    if (typeof keyOrCallback === 'function') {
      return super.find(keyOrCallback);
    }

    return this.first((item) => item.getKey() === keyOrCallback);
  }

  /**
   * Determine if a model key exists in the collection
   */
  contains(keyOrCallback: any | ((item: T) => boolean)): boolean {
    return this.find(keyOrCallback) !== undefined;
  }
}
