/**
 * BelongsTo Relationship
 *
 * Represents an inverse one-to-one or many relationship
 */

import { Ensemble } from '@/Database/Ensemble/Ensemble';
import { EnsembleBuilder } from '@/Database/Ensemble/EnsembleBuilder';
import { EnsembleCollection } from '@/Database/Ensemble/EnsembleCollection';
import { Relation } from './Relation';

export class BelongsTo<TRelated extends Ensemble, TParent extends Ensemble> extends Relation<TRelated, TParent> {
  /**
   * The foreign key of the parent model
   */
  protected foreignKey: string;

  /**
   * The associated key on the parent model
   */
  protected ownerKey: string;

  /**
   * The name of the relationship
   */
  protected relationName: string;

  /**
   * Create a new belongs to relationship instance
   */
  constructor(
    query: EnsembleBuilder<TRelated>,
    parent: TParent,
    foreignKey: string,
    ownerKey: string,
    relationName: string
  ) {
    super(query, parent);
    this.foreignKey = foreignKey;
    this.ownerKey = ownerKey;
    this.relationName = relationName;
    this.initializeRelation();
  }

  /**
   * Set the base constraints on the relation query
   */
  addConstraints(): void {
    if (Relation['constraints']) {
      const foreignKeyValue = this.getForeignKeyValue();

      // Only add constraint if foreign key value exists
      if (foreignKeyValue !== null && foreignKeyValue !== undefined) {
        this.query.where(this.ownerKey, '=', foreignKeyValue);
      }
    }
  }

  /**
   * Set the constraints for an eager load of the relation
   */
  addEagerConstraints(models: TParent[]): void {
    const keys = this.getEagerModelKeys(models);
    this.query.whereIn(this.ownerKey, keys);
  }

  /**
   * Gather the keys from an array of related models
   */
  protected getEagerModelKeys(models: TParent[]): any[] {
    const keys: any[] = [];

    for (const model of models) {
      const value = model.getAttribute(this.foreignKey);

      if (value !== null && value !== undefined) {
        keys.push(value);
      }
    }

    return [...new Set(keys)];
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
      const key = model.getAttribute(this.foreignKey);

      if (key !== null && key !== undefined && dictionary[key]) {
        model.setRelation(relation, dictionary[key]);
      }
    }

    return models;
  }

  /**
   * Build model dictionary keyed by the relation's owner key
   */
  protected buildDictionary(results: EnsembleCollection<TRelated>): Record<any, TRelated> {
    const dictionary: Record<any, TRelated> = {};

    for (const result of results) {
      const key = result.getAttribute(this.ownerKey);

      if (key !== null && key !== undefined) {
        dictionary[key] = result;
      }
    }

    return dictionary;
  }

  /**
   * Get the results of the relationship
   */
  async getResults(): Promise<TRelated | null> {
    const foreignKeyValue = this.getForeignKeyValue();

    if (!foreignKeyValue) {
      return null;
    }

    this.ensureConstraints();
    return this.query.first();
  }

  /**
   * Get the value of the model's foreign key
   */
  protected getForeignKeyValue(): any {
    return this.parent.getAttribute(this.foreignKey);
  }

  /**
   * Get the foreign key for the relationship
   */
  getForeignKeyName(): string {
    return this.foreignKey;
  }

  /**
   * Get the owner key for the relationship
   */
  getOwnerKeyName(): string {
    return this.ownerKey;
  }

  /**
   * Get the name of the relationship
   */
  getRelationName(): string {
    return this.relationName;
  }

  /**
   * Associate the model instance to the given parent
   */
  associate(model: TRelated | null): TParent {
    const ownerKey = model ? model.getAttribute(this.ownerKey) : null;

    this.parent.setAttribute(this.foreignKey, ownerKey);

    if (model) {
      this.parent.setRelation(this.relationName, model);
    } else {
      this.parent.unsetRelation(this.relationName);
    }

    return this.parent;
  }

  /**
   * Dissociate previously associated model from the given parent
   */
  dissociate(): TParent {
    this.parent.setAttribute(this.foreignKey, null);
    this.parent.setRelation(this.relationName, null);

    return this.parent;
  }

  /**
   * Execute the query as a "select" statement
   * Override base to return single model instead of array
   */
  // @ts-expect-error - BelongsTo returns single model, not array
  async get(): Promise<TRelated | null> {
    return this.getResults();
  }

  /**
   * Update the parent model on the relationship
   */
  async update(attributes: Record<string, any>): Promise<number> {
    return this.query.update(attributes);
  }

  /**
   * Get the default foreign key name for the relationship
   */
  protected getDefaultForeignKeyName(): string {
    return this.snake(this.relationName) + '_' + this.related.getKeyName();
  }

  /**
   * Convert a string to snake case
   */
  protected snake(value: string): string {
    return value
      .replace(/([A-Z])/g, '_$1')
      .toLowerCase()
      .replace(/^_/, '');
  }
}
