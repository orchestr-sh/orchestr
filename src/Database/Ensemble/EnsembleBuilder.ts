/**
 * EnsembleBuilder
 *
 * Extends the query builder to work with Ensemble models
 */

import { Builder as QueryBuilder } from '@/Database/Query/Builder';
import { DatabaseAdapter } from '@/Database/Contracts/DatabaseAdapter';
import { Ensemble } from './Ensemble';
import { EnsembleCollection } from './EnsembleCollection';
import { Relation } from './Relations';

export class EnsembleBuilder<T extends Ensemble> extends QueryBuilder<T> {
  /**
   * The model being queried
   */
  protected model: T;

  /**
   * The relationships that should be eager loaded
   */
  protected eagerLoad: Record<string, (query: any) => void> = {};

  constructor(adapter: DatabaseAdapter, model: T) {
    super(adapter);
    this.model = model;
    this.from(model.getTable());
  }

  /**
   * Find a model by its primary key
   */
  async find(id: any): Promise<T | null> {
    return this.where(this.model.getKeyName(), '=', id).first();
  }

  /**
   * Execute the query and get all results
   */
  async get(): Promise<T[]> {
    const results = await super.get();
    const models = this.hydrate(results);

    if (Object.keys(this.eagerLoad).length > 0) {
      await this.eagerLoadRelations(models);
    }

    return models;
  }

  /**
   * Get the first record
   */
  async first(): Promise<T | null> {
    const results = await this.limit(1).get();
    return results[0] || null;
  }

  /**
   * Create a collection of models from plain arrays
   */
  protected hydrate(items: any[]): T[] {
    return items.map((item) => this.newModelInstance(item, true));
  }

  /**
   * Create a new instance of the model
   */
  protected newModelInstance(attributes: Record<string, any> = {}, exists: boolean = false): T {
    const ModelClass = this.model.constructor as new (attributes: Record<string, any>, fromDatabase: boolean) => T;
    // Pass true for fromDatabase to bypass fillable/guarded checks when hydrating from DB
    const instance = new ModelClass(attributes, exists);
    (instance as any).exists = exists;
    (instance as any).syncOriginal();

    // Fire retrieved event if this is from database
    if (exists) {
      // Fire asynchronously but don't wait for it
      (instance as any).fireModelEvent?.('retrieved').catch(() => {
        // Silently ignore errors from event firing during hydration
      });
    }

    return instance;
  }

  /**
   * Add a select statement to the query
   */
  addSelect(...columns: string[]): this {
    if (this._columns.length === 1 && this._columns[0] === '*') {
      this._columns = [];
    }
    this._columns.push(...columns);
    return this;
  }

  /**
   * Set the relationships that should be eager loaded
   */
  with(relations: string | string[] | Record<string, (query: any) => void>): this {
    if (typeof relations === 'string') {
      this.eagerLoad[relations] = () => {};
    } else if (Array.isArray(relations)) {
      for (const relation of relations) {
        this.eagerLoad[relation] = () => {};
      }
    } else {
      for (const [relation, callback] of Object.entries(relations)) {
        this.eagerLoad[relation] = callback;
      }
    }

    return this;
  }

  /**
   * Eager load the relationships for the models
   */
  protected async eagerLoadRelations(models: T[]): Promise<void> {
    for (const [name, constraints] of Object.entries(this.eagerLoad)) {
      if (models.length === 0) {
        continue;
      }

      // Parse nested relations (e.g., "posts.comments")
      const segments = name.split('.');

      if (segments.length > 1) {
        await this.eagerLoadNestedRelations(models, name, constraints);
      } else {
        await this.eagerLoadRelation(models, name, constraints);
      }
    }
  }

  /**
   * Eagerly load the relationship on a set of models
   */
  protected async eagerLoadRelation(models: T[], name: string, constraints: (query: any) => void): Promise<void> {
    // Get the relation instance from the first model
    const relation = this.getRelation(models[0], name);

    // Set the eager constraints
    relation.addEagerConstraints(models);

    // Apply any additional constraints
    constraints(relation);

    // Initialize the relation on all models
    relation.initRelation(models, name);

    // Get the eager results
    const results = await relation.getEager();

    // Match the results back to their parent models
    relation.match(models, new EnsembleCollection(results), name);
  }

  /**
   * Eagerly load nested relationships
   */
  protected async eagerLoadNestedRelations(
    models: T[],
    name: string,
    constraints: (query: any) => void
  ): Promise<void> {
    const segments = name.split('.');
    const firstSegment = segments[0];
    const remainingSegments = segments.slice(1).join('.');

    // Load the first level relationship
    await this.eagerLoadRelation(models, firstSegment, () => {});

    // Get all the loaded models from the first relationship
    const relatedModels: Ensemble[] = [];
    for (const model of models) {
      const related = model.getRelation(firstSegment);
      if (related) {
        if (Array.isArray(related)) {
          relatedModels.push(...related);
        } else if (related instanceof EnsembleCollection) {
          relatedModels.push(...related);
        } else {
          relatedModels.push(related);
        }
      }
    }

    // Recursively load the nested relationships
    if (relatedModels.length > 0 && relatedModels[0]) {
      const nestedBuilder = relatedModels[0].newQuery();
      nestedBuilder.eagerLoad[remainingSegments] = constraints;
      await nestedBuilder.eagerLoadRelations(relatedModels as any[]);
    }
  }

  /**
   * Get the relation instance for the given relation name
   */
  protected getRelation(model: T, name: string): Relation<any, any> {
    const relationMethod = (model as any)[name];

    if (typeof relationMethod !== 'function') {
      throw new Error(`Call to undefined relationship [${name}] on model [${model.constructor.name}]`);
    }

    const relation = relationMethod.call(model);

    if (!(relation instanceof Relation)) {
      throw new Error(`Relationship method [${name}] must return a Relation instance`);
    }

    // Disable default constraints for eager loading
    const originalConstraints = Relation['constraints'];
    Relation['constraints'] = false;
    const freshRelation = relationMethod.call(model);
    Relation['constraints'] = originalConstraints;

    return freshRelation;
  }

  /**
   * Create a new model and store it in the database
   */
  async create(attributes: Record<string, any>): Promise<T> {
    const instance = this.newModelInstance(attributes);
    await instance.save();
    return instance;
  }

  /**
   * Update records in the database
   */
  async update(values: Record<string, any>): Promise<number> {
    return await super.update(values);
  }

  /**
   * Delete records from the database
   */
  async delete(): Promise<number> {
    return await super.delete();
  }

  /**
   * Get a paginated result
   */
  async paginate(
    perPage: number = 15,
    page: number = 1
  ): Promise<{
    data: T[];
    total: number;
    perPage: number;
    currentPage: number;
    lastPage: number;
    from: number;
    to: number;
  }> {
    const total = await this.clone().count();
    const offset = (page - 1) * perPage;

    const data = await this.clone().offset(offset).limit(perPage).get();

    const lastPage = Math.ceil(total / perPage);
    const from = total > 0 ? offset + 1 : 0;
    const to = Math.min(offset + perPage, total);

    return {
      data,
      total,
      perPage,
      currentPage: page,
      lastPage,
      from,
      to,
    };
  }

  /**
   * Chunk the results of the query
   */
  async chunk(count: number, callback: (models: T[]) => Promise<boolean | void>): Promise<void> {
    let page = 1;

    while (true) {
      const results = await this.clone()
        .offset((page - 1) * count)
        .limit(count)
        .get();

      if (results.length === 0) {
        break;
      }

      const shouldContinue = await callback(results);
      if (shouldContinue === false) {
        break;
      }

      page++;
    }
  }

  /**
   * Clone the query builder
   */
  clone(): EnsembleBuilder<T> {
    const cloned = new EnsembleBuilder<T>(this.adapter, this.model);
    cloned._columns = [...this._columns];
    cloned._distinct = this._distinct;
    cloned._table = this._table;
    cloned._wheres = [...this._wheres];
    cloned._joins = [...this._joins];
    cloned._orders = [...this._orders];
    cloned._groups = [...this._groups];
    cloned._havings = [...this._havings];
    cloned._limit = this._limit;
    cloned._offset = this._offset;
    cloned._bindings = [...this._bindings];
    cloned.eagerLoad = { ...this.eagerLoad };
    return cloned;
  }
}
