/**
 * MorphOne Relationship
 *
 * Represents a polymorphic one-to-one relationship
 * Example: Post has one Image (where Image belongs to many types)
 */

import { Ensemble } from '@/Database/Ensemble/Ensemble';
import { EnsembleBuilder } from '@/Database/Ensemble/EnsembleBuilder';
import { EnsembleCollection } from '@/Database/Ensemble/EnsembleCollection';
import { Relation } from './Relation';
import { MorphMap } from './MorphMap';

export class MorphOne<TRelated extends Ensemble, TParent extends Ensemble> extends Relation<TRelated, TParent> {
  /**
   * The foreign key of the parent model (e.g., 'imageable_id')
   */
  protected foreignKey: string;

  /**
   * The morph type column (e.g., 'imageable_type')
   */
  protected morphType: string;

  /**
   * The local key of the parent model
   */
  protected localKey: string;

  /**
   * The morph class name or alias
   */
  protected morphClass: string;

  /**
   * Create a new morph one relationship instance
   */
  constructor(
    query: EnsembleBuilder<TRelated>,
    parent: TParent,
    name: string,
    type: string | null,
    id: string | null,
    localKey: string
  ) {
    super(query, parent);

    this.morphType = type || `${name}_type`;
    this.foreignKey = id || `${name}_id`;
    this.localKey = localKey;
    this.morphClass = this.getMorphClass();

    this.initializeRelation();
  }

  /**
   * Set the base constraints on the relation query
   */
  addConstraints(): void {
    if (Relation['constraints']) {
      const parentKey = this.getParentKey();

      // Only add constraints if parent key exists
      if (parentKey !== null && parentKey !== undefined) {
        this.query.where(this.foreignKey, '=', parentKey).where(this.morphType, '=', this.morphClass);
      }
    }
  }

  /**
   * Set the constraints for an eager load of the relation
   */
  addEagerConstraints(models: TParent[]): void {
    const keys = this.getKeys(models, this.localKey);
    this.query.whereIn(this.foreignKey, keys).where(this.morphType, '=', this.morphClass);
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

    this.ensureConstraints();
    return this.query.first();
  }

  /**
   * Get the key value of the parent's local key
   */
  protected getParentKey(): any {
    return this.parent.getAttribute(this.localKey);
  }

  /**
   * Get the morph class for the parent
   */
  protected getMorphClass(): string {
    return MorphMap.getMorphedModel(this.parent);
  }

  /**
   * Get the foreign key for the relationship
   */
  getForeignKeyName(): string {
    return this.foreignKey;
  }

  /**
   * Get the morph type for the relationship
   */
  getMorphType(): string {
    return this.morphType;
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

    // Set both the foreign key and morph type
    instance.setAttribute(this.foreignKey, this.getParentKey());
    instance.setAttribute(this.morphType, this.morphClass);

    await instance.save();

    return instance;
  }

  /**
   * Save a model and set the foreign key and morph type
   */
  async save(model: TRelated): Promise<TRelated> {
    model.setAttribute(this.foreignKey, this.getParentKey());
    model.setAttribute(this.morphType, this.morphClass);

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
