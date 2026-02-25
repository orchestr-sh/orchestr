/**
 * MorphTo Relationship
 *
 * Represents a polymorphic inverse relationship
 * Example: Comment belongs to Post or Video (commentable)
 */

import { Ensemble } from '@/Database/Ensemble/Ensemble';
import { EnsembleBuilder } from '@/Database/Ensemble/EnsembleBuilder';
import { EnsembleCollection } from '@/Database/Ensemble/EnsembleCollection';
import { Relation } from './Relation';
import { MorphMap } from './MorphMap';

export class MorphTo<TParent extends Ensemble> extends Relation<Ensemble, TParent> {
  /**
   * The foreign key of the parent model (e.g., 'commentable_id')
   */
  protected foreignKey: string;

  /**
   * The morph type column (e.g., 'commentable_type')
   */
  protected morphType: string;

  /**
   * The owner key on the related model
   */
  protected ownerKey: string;

  /**
   * The name of the relationship
   */
  protected relationName: string;

  /**
   * Dictionary of models grouped by type
   */
  protected dictionary: Map<string, Map<any, Ensemble>> = new Map();

  /**
   * Models loaded by type
   */
  protected models: Map<string, Ensemble[]> = new Map();

  /**
   * Create a new morph to relationship instance
   */
  constructor(
    query: EnsembleBuilder<Ensemble>,
    parent: TParent,
    foreignKey: string,
    morphType: string,
    ownerKey: string,
    relationName: string
  ) {
    super(query, parent);
    this.foreignKey = foreignKey;
    this.morphType = morphType;
    this.ownerKey = ownerKey;
    this.relationName = relationName;
    // Don't call initializeRelation() - MorphTo doesn't add constraints in constructor
  }

  /**
   * Set the base constraints on the relation query
   * MorphTo doesn't use base constraints - queries are built per type
   */
  addConstraints(): void {
    // MorphTo doesn't add constraints here
    // Constraints are added dynamically based on type
  }

  /**
   * Set the constraints for an eager load of the relation
   */
  addEagerConstraints(models: TParent[]): void {
    // Build dictionary grouped by type
    this.buildDictionary(models);
  }

  /**
   * Build dictionary of models grouped by morph type
   */
  protected buildDictionary(models: TParent[]): void {
    this.dictionary.clear();

    for (const model of models) {
      const type = model.getAttribute(this.morphType);
      const id = model.getAttribute(this.foreignKey);

      if (!type || id === null || id === undefined) {
        continue;
      }

      if (!this.dictionary.has(type)) {
        this.dictionary.set(type, new Map());
      }

      const typeDict = this.dictionary.get(type)!;
      typeDict.set(id, null as any); // Placeholder, will be replaced in match
    }
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
  match(models: TParent[], results: EnsembleCollection<Ensemble>, relation: string): TParent[] {
    // Match each model with its related parent
    for (const model of models) {
      const type = model.getAttribute(this.morphType);
      const id = model.getAttribute(this.foreignKey);

      if (!type || id === null || id === undefined) {
        model.setRelation(relation, null);
        continue;
      }

      const typeDict = this.dictionary.get(type);
      if (typeDict && typeDict.has(id)) {
        const related = typeDict.get(id);
        model.setRelation(relation, related || null);
      } else {
        model.setRelation(relation, null);
      }
    }

    return models;
  }

  /**
   * Get the eager loading results
   */
  async getEager(): Promise<Ensemble[]> {
    const allResults: Ensemble[] = [];

    for (const [type, ids] of this.dictionary.entries()) {
      const modelClass = MorphMap.getClass(type);

      if (!modelClass) {
        console.warn(`MorphTo: Unknown morph type "${type}". Did you forget to register it in MorphMap?`);
        continue;
      }

      const instance = new modelClass();
      const models = await instance.newQuery().whereIn(this.ownerKey, Array.from(ids.keys())).get();

      // Store in dictionary for matching
      for (const model of models) {
        const key = model.getAttribute(this.ownerKey);
        const typeDict = this.dictionary.get(type);
        if (typeDict && typeDict.has(key)) {
          typeDict.set(key, model);
        }
      }

      allResults.push(...models);
    }

    return allResults;
  }

  /**
   * Get the results of the relationship
   */
  async getResults(): Promise<Ensemble | null> {
    const type = this.parent.getAttribute(this.morphType);
    const id = this.parent.getAttribute(this.foreignKey);

    if (!type || id === null || id === undefined) {
      return null;
    }

    const modelClass = MorphMap.getClass(type);

    if (!modelClass) {
      console.warn(`MorphTo: Unknown morph type "${type}". Did you forget to register it in MorphMap?`);
      return null;
    }

    const instance = new modelClass();
    return instance.newQuery().where(this.ownerKey, '=', id).first();
  }

  /**
   * Associate the model instance to the parent model
   */
  associate(model: Ensemble | null): this {
    if (model === null) {
      return this.dissociate();
    }

    this.parent.setAttribute(this.foreignKey, model.getAttribute(this.ownerKey));
    this.parent.setAttribute(this.morphType, MorphMap.getMorphedModel(model));
    this.parent.setRelation(this.relationName, model);

    return this;
  }

  /**
   * Dissociate the model from the parent
   */
  dissociate(): this {
    this.parent.setAttribute(this.foreignKey, null);
    this.parent.setAttribute(this.morphType, null);
    this.parent.setRelation(this.relationName, null);

    return this;
  }

  /**
   * Get the foreign key value
   */
  protected getForeignKeyValue(): any {
    return this.parent.getAttribute(this.foreignKey);
  }

  /**
   * Get the morph type value
   */
  protected getMorphTypeValue(): string | null {
    return this.parent.getAttribute(this.morphType);
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
   * Get the owner key for the relationship
   */
  getOwnerKeyName(): string {
    return this.ownerKey;
  }
}
