/**
 * HasMany Relationship
 *
 * Represents a one-to-many relationship
 */

import { Ensemble } from '../Ensemble';
import { EnsembleBuilder } from '../EnsembleBuilder';
import { EnsembleCollection } from '../EnsembleCollection';
import { Relation } from './Relation';

export class HasMany<TRelated extends Ensemble, TParent extends Ensemble> extends Relation<TRelated, TParent> {
  /**
   * The foreign key of the parent model
   */
  protected foreignKey: string;

  /**
   * The local key of the parent model
   */
  protected localKey: string;

  /**
   * Create a new has many relationship instance
   */
  constructor(
    query: EnsembleBuilder<TRelated>,
    parent: TParent,
    foreignKey: string,
    localKey: string
  ) {
    super(query, parent);
    this.foreignKey = foreignKey;
    this.localKey = localKey;
    this.initializeRelation();
  }

  /**
   * Set the base constraints on the relation query
   */
  addConstraints(): void {
    if (Relation['constraints']) {
      this.query.where(
        this.foreignKey,
        '=',
        this.getParentKey()
      );
    }
  }

  /**
   * Set the constraints for an eager load of the relation
   */
  addEagerConstraints(models: TParent[]): void {
    const keys = this.getKeys(models, this.localKey);
    this.query.whereIn(this.foreignKey, keys);
  }

  /**
   * Initialize the relation on a set of models
   */
  initRelation(models: TParent[], relation: string): TParent[] {
    for (const model of models) {
      model.setRelation(relation, new EnsembleCollection<TRelated>());
    }

    return models;
  }

  /**
   * Match the eagerly loaded results to their parents
   */
  match(models: TParent[], results: EnsembleCollection<TRelated>, relation: string): TParent[] {
    const dictionary = this.buildDictionary(results);

    for (const model of models) {
      const key = model.getAttribute(this.localKey);

      if (key !== null && key !== undefined && dictionary[key]) {
        model.setRelation(
          relation,
          new EnsembleCollection<TRelated>(dictionary[key])
        );
      }
    }

    return models;
  }

  /**
   * Build model dictionary keyed by the relation's foreign key
   */
  protected buildDictionary(results: EnsembleCollection<TRelated>): Record<any, TRelated[]> {
    const dictionary: Record<any, TRelated[]> = {};

    for (const result of results) {
      const key = result.getAttribute(this.foreignKey);

      if (key !== null && key !== undefined) {
        if (!dictionary[key]) {
          dictionary[key] = [];
        }
        dictionary[key].push(result);
      }
    }

    return dictionary;
  }

  /**
   * Get the results of the relationship
   */
  async getResults(): Promise<TRelated[]> {
    if (!this.getParentKey()) {
      return [];
    }

    this.ensureConstraints();
    return this.query.get();
  }

  /**
   * Get the key value of the parent's local key
   */
  protected getParentKey(): any {
    return this.parent.getAttribute(this.localKey);
  }

  /**
   * Get the foreign key for the relationship
   */
  getForeignKeyName(): string {
    return this.foreignKey;
  }

  /**
   * Get the local key for the relationship
   */
  getLocalKeyName(): string {
    return this.localKey;
  }

  /**
   * Make a new related instance
   */
  make(attributes: Record<string, any> = {}): TRelated {
    return this.related.newInstance(attributes);
  }

  /**
   * Create a new instance of the related model
   */
  async create(attributes: Record<string, any> = {}): Promise<TRelated> {
    const instance = this.make(attributes);

    instance.setAttribute(
      this.foreignKey,
      this.getParentKey()
    );

    await instance.save();

    return instance;
  }

  /**
   * Create an array of new instances of the related model
   */
  async createMany(records: Record<string, any>[]): Promise<TRelated[]> {
    const instances: TRelated[] = [];

    for (const record of records) {
      instances.push(await this.create(record));
    }

    return instances;
  }

  /**
   * Create a new instance and set the foreign key
   */
  async save(model: TRelated): Promise<TRelated> {
    model.setAttribute(
      this.foreignKey,
      this.getParentKey()
    );

    await model.save();

    return model;
  }

  /**
   * Save multiple models with the foreign key set
   */
  async saveMany(models: TRelated[]): Promise<TRelated[]> {
    for (const model of models) {
      await this.save(model);
    }

    return models;
  }

  /**
   * Find a related model by its primary key
   */
  async find(id: any): Promise<TRelated | null> {
    return this.query.where(this.related.getKeyName(), '=', id).first();
  }

  /**
   * Find multiple related models by their primary keys
   */
  async findMany(ids: any[]): Promise<TRelated[]> {
    return this.query.whereIn(this.related.getKeyName(), ids).get();
  }

  /**
   * Find a related model by its primary key or throw an exception
   */
  async findOrFail(id: any): Promise<TRelated> {
    const result = await this.find(id);

    if (!result) {
      throw new Error(`Model not found with id: ${id}`);
    }

    return result;
  }

  /**
   * Get the first related model matching the attributes or create it
   */
  async firstOrCreate(attributes: Record<string, any>, values: Record<string, any> = {}): Promise<TRelated> {
    let query = this.query.clone();

    // Apply each attribute as a where clause
    for (const [key, value] of Object.entries(attributes)) {
      query = query.where(key, '=', value);
    }

    const instance = await query.first();

    if (instance) {
      return instance;
    }

    return this.create({ ...attributes, ...values });
  }

  /**
   * Update the parent model on the relationship
   */
  async update(attributes: Record<string, any>): Promise<number> {
    const updatedAtColumn = this.related.getUpdatedAtColumn();
    if (updatedAtColumn) {
      attributes[updatedAtColumn] = new Date();
    }

    return this.query.update(attributes);
  }
}
