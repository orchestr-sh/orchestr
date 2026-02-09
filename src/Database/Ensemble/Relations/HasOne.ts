/**
 * HasOne Relationship
 *
 * Represents a one-to-one relationship
 */

import { Ensemble } from '../Ensemble';
import { EnsembleBuilder } from '../EnsembleBuilder';
import { EnsembleCollection } from '../EnsembleCollection';
import { Relation } from './Relation';

export class HasOne<TRelated extends Ensemble, TParent extends Ensemble> extends Relation<TRelated, TParent> {
  /**
   * The foreign key of the parent model
   */
  protected foreignKey: string;

  /**
   * The local key of the parent model
   */
  protected localKey: string;

  /**
   * Create a new has one relationship instance
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
      model.setRelation(relation, null);
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
        model.setRelation(relation, dictionary[key][0]);
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
  async getResults(): Promise<TRelated | null> {
    if (!this.getParentKey()) {
      return null;
    }

    return this.query.first();
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
