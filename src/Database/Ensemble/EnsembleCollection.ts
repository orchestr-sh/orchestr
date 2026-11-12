/**
 * EnsembleCollection Class
 *
 * A collection of Ensemble models. All generic collection behaviour is
 * inherited from the framework's Support Collection; only model-specific
 * helpers live here. Methods that return new collections preserve this
 * concrete class at runtime.
 */

import { Collection } from '@/Support/Collection';
import { createAggregateLoads, type AggregateRelations } from './Aggregates';
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

  // -------------------------------------------------------------------------
  // Relationship aggregates
  // -------------------------------------------------------------------------

  /**
   * Attach aggregate values of a relationship to every model in the collection
   *
   * The whole collection is aggregated by one grouped query per relation, so
   * loading counts on a hundred models still costs one select.
   */
  protected async loadAggregate(type: string, relations: AggregateRelations, column: string = '*'): Promise<this> {
    const models = this.all();

    if (models.length === 0) {
      return this;
    }

    await models[0].newQuery().loadAggregates(models, createAggregateLoads(type, relations, column));

    return this;
  }

  /**
   * Load the number of related rows onto every model
   */
  async loadCount(relations: AggregateRelations): Promise<this> {
    return this.loadAggregate('count', relations);
  }

  /**
   * Load the sum of a related column onto every model
   */
  async loadSum(relations: AggregateRelations, column: string): Promise<this> {
    return this.loadAggregate('sum', relations, column);
  }

  /**
   * Load the average of a related column onto every model
   */
  async loadAvg(relations: AggregateRelations, column: string): Promise<this> {
    return this.loadAggregate('avg', relations, column);
  }

  /**
   * Load the smallest value of a related column onto every model
   */
  async loadMin(relations: AggregateRelations, column: string): Promise<this> {
    return this.loadAggregate('min', relations, column);
  }

  /**
   * Load the largest value of a related column onto every model
   */
  async loadMax(relations: AggregateRelations, column: string): Promise<this> {
    return this.loadAggregate('max', relations, column);
  }

  /**
   * Load whether each model has related rows
   */
  async loadExists(relations: AggregateRelations): Promise<this> {
    return this.loadAggregate('exists', relations);
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
