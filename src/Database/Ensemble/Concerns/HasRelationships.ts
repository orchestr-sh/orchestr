/**
 * HasRelationships Concern
 *
 * Provides relationship functionality to Ensemble models
 */

import { createAggregateLoads, type AggregateRelations } from '@/Database/Ensemble/Aggregates';
import { Ensemble } from '@/Database/Ensemble/Ensemble';
import { EnsembleBuilder } from '@/Database/Ensemble/EnsembleBuilder';
import { BelongsTo } from '@/Database/Ensemble/Relations/BelongsTo';
import { BelongsToMany } from '@/Database/Ensemble/Relations/BelongsToMany';
import { HasMany } from '@/Database/Ensemble/Relations/HasMany';
import { HasOne } from '@/Database/Ensemble/Relations/HasOne';
import { MorphedByMany } from '@/Database/Ensemble/Relations/MorphedByMany';
import { MorphMany } from '@/Database/Ensemble/Relations/MorphMany';
import { MorphOne } from '@/Database/Ensemble/Relations/MorphOne';
import { MorphTo } from '@/Database/Ensemble/Relations/MorphTo';
import { MorphToMany } from '@/Database/Ensemble/Relations/MorphToMany';
import { Relation } from '@/Database/Ensemble/Relations/Relation';

export interface RelationshipConfig {
  type:
    | 'hasOne'
    | 'hasMany'
    | 'belongsTo'
    | 'belongsToMany'
    | 'hasOneThrough'
    | 'hasManyThrough'
    | 'morphTo'
    | 'morphMany'
    | 'morphOne'
    | 'morphToMany'
    | 'morphedByMany';
  related: string;
  foreignKey?: string;
  localKey?: string;
  relation?: string;
}

export abstract class HasRelationshipsMixin {
  /**
   * The loaded relationships for the model
   */
  protected relations: Record<string, any> = {};

  /**
   * Define a one-to-one relationship
   */
  protected hasOne<TRelated extends Ensemble>(
    related: new () => TRelated,
    foreignKey?: string,
    localKey?: string
  ): HasOne<TRelated, any> {
    const instance = new related();

    const finalForeignKey = foreignKey || this.getForeignKey();
    const finalLocalKey = localKey || (this as any).getKeyName();

    return new HasOne<TRelated, any>(
      instance.newQuery() as EnsembleBuilder<TRelated>,
      this as any,
      finalForeignKey,
      finalLocalKey
    );
  }

  /**
   * Define a one-to-many relationship
   */
  protected hasMany<TRelated extends Ensemble>(
    related: new () => TRelated,
    foreignKey?: string,
    localKey?: string
  ): HasMany<TRelated, any> {
    const instance = new related();

    const finalForeignKey = foreignKey || this.getForeignKey();
    const finalLocalKey = localKey || (this as any).getKeyName();

    return new HasMany<TRelated, any>(
      instance.newQuery() as EnsembleBuilder<TRelated>,
      this as any,
      finalForeignKey,
      finalLocalKey
    );
  }

  /**
   * Define an inverse one-to-one or many relationship
   */
  protected belongsTo<TRelated extends Ensemble>(
    related: new () => TRelated,
    foreignKey?: string,
    ownerKey?: string,
    relation?: string
  ): BelongsTo<TRelated, any> {
    const instance = new related();
    const relationName = relation || this.snake(instance.constructor.name);

    if (!foreignKey) {
      // Generate foreign key from relation name + primary key
      // Note: relationName should be singular (e.g., "user" not "users")
      // If your model class is plural, pass the relation parameter explicitly
      foreignKey = relationName + '_' + instance.getKeyName();
    }

    const finalOwnerKey = ownerKey || instance.getKeyName();

    return new BelongsTo<TRelated, any>(
      instance.newQuery() as EnsembleBuilder<TRelated>,
      this as any,
      foreignKey,
      finalOwnerKey,
      relationName
    );
  }

  /**
   * Define a many-to-many relationship
   */
  protected belongsToMany<TRelated extends Ensemble>(
    related: new () => TRelated,
    table?: string,
    foreignPivotKey?: string,
    relatedPivotKey?: string,
    parentKey?: string,
    relatedKey?: string,
    relation?: string
  ): BelongsToMany<TRelated, any> {
    const instance = new related();

    // If no table name was provided, use the default
    if (!table) {
      table = this.joiningTable(instance);
    }

    // Get the foreign key for the parent model
    foreignPivotKey = foreignPivotKey || this.getForeignKey();

    // Get the foreign key for the related model
    relatedPivotKey = relatedPivotKey || instance.getForeignKey();

    // Get the parent key
    const finalParentKey = parentKey || (this as any).getKeyName();

    // Get the related key
    const finalRelatedKey = relatedKey || instance.getKeyName();

    return new BelongsToMany<TRelated, any>(
      instance.newQuery() as EnsembleBuilder<TRelated>,
      this as any,
      table,
      foreignPivotKey,
      relatedPivotKey,
      finalParentKey,
      finalRelatedKey,
      relation || ''
    );
  }

  /**
   * Define a polymorphic one-to-one relationship
   */
  protected morphOne<TRelated extends Ensemble>(
    related: new () => TRelated,
    name: string,
    type?: string | null,
    id?: string | null,
    localKey?: string
  ): MorphOne<TRelated, any> {
    const instance = new related();

    const finalLocalKey = localKey || (this as any).getKeyName();

    return new MorphOne(
      instance.newQuery() as EnsembleBuilder<TRelated>,
      this as any,
      name,
      type ?? null,
      id ?? null,
      finalLocalKey
    );
  }

  /**
   * Define a polymorphic one-to-many relationship
   */
  protected morphMany<TRelated extends Ensemble>(
    related: new () => TRelated,
    name: string,
    type?: string | null,
    id?: string | null,
    localKey?: string
  ): MorphMany<TRelated, any> {
    const instance = new related();

    const finalLocalKey = localKey || (this as any).getKeyName();

    return new MorphMany(
      instance.newQuery() as EnsembleBuilder<TRelated>,
      this as any,
      name,
      type ?? null,
      id ?? null,
      finalLocalKey
    );
  }

  /**
   * Define a polymorphic inverse relationship
   */
  protected morphTo(name: string, type?: string, id?: string, ownerKey?: string): MorphTo<any> {
    const finalType = type || `${name}_type`;
    const finalId = id || `${name}_id`;
    const finalOwnerKey = ownerKey || 'id';

    // MorphTo needs special handling - creates query builder dynamically
    return new MorphTo((this as any).newQuery() as any, this as any, finalId, finalType, finalOwnerKey, name);
  }

  /**
   * Define a polymorphic many-to-many relationship
   */
  protected morphToMany<TRelated extends Ensemble>(
    related: new () => TRelated,
    name: string,
    table?: string,
    foreignPivotKey?: string,
    relatedPivotKey?: string,
    parentKey?: string,
    relatedKey?: string,
    inverse: boolean = false
  ): MorphToMany<TRelated, any> {
    const instance = new related();

    const finalTable = table || `${name}s`;
    const finalForeignPivotKey = foreignPivotKey || `${name}_id`;
    const finalRelatedPivotKey = relatedPivotKey || instance.getForeignKey();
    const morphType = `${name}_type`;
    const finalParentKey = parentKey || (this as any).getKeyName();
    const finalRelatedKey = relatedKey || instance.getKeyName();

    return new MorphToMany(
      instance.newQuery() as EnsembleBuilder<TRelated>,
      this as any,
      name,
      finalTable,
      finalForeignPivotKey,
      finalRelatedPivotKey,
      morphType,
      finalParentKey,
      finalRelatedKey,
      '',
      inverse
    );
  }

  /**
   * Define the inverse of a polymorphic many-to-many relationship
   */
  protected morphedByMany<TRelated extends Ensemble>(
    related: new () => TRelated,
    name: string,
    table?: string,
    foreignPivotKey?: string,
    relatedPivotKey?: string,
    parentKey?: string,
    relatedKey?: string
  ): MorphedByMany<TRelated, any> {
    const instance = new related();

    const finalTable = table || `${name}s`;
    const finalForeignPivotKey = foreignPivotKey || `${name}_id`;
    const finalRelatedPivotKey = relatedPivotKey || instance.getForeignKey();
    const morphType = `${name}_type`;
    const finalParentKey = parentKey || (this as any).getKeyName();
    const finalRelatedKey = relatedKey || instance.getKeyName();

    return new MorphedByMany(
      instance.newQuery() as EnsembleBuilder<TRelated>,
      this as any,
      name,
      finalTable,
      finalForeignPivotKey,
      finalRelatedPivotKey,
      morphType,
      finalParentKey,
      finalRelatedKey,
      ''
    );
  }

  /**
   * Get the joining table name for a many-to-many relation
   */
  protected joiningTable(related: Ensemble): string {
    const models = [this.snake((this as any).constructor.name), this.snake(related.constructor.name)];

    // Sort the model names alphabetically
    models.sort();

    return models.join('_');
  }

  /**
   * Get the default foreign key name for the model
   */
  protected getForeignKey(): string {
    return this.snake((this as any).constructor.name) + '_' + (this as any).getKeyName();
  }

  /**
   * Get a relationship value from a method
   */
  protected getRelationshipFromMethod(method: string): any {
    const relation = (this as any)[method]();

    if (!(relation instanceof Relation)) {
      throw new Error(`Relationship method must return an object of type Relation (${method})`);
    }

    return relation;
  }

  /**
   * Get a relationship instance by name
   */
  public getRelation(relation: string): any {
    return this.relations[relation];
  }

  /**
   * Set the given relationship on the model
   */
  public setRelation(relation: string, value: any): this {
    this.relations[relation] = value;
    return this as any;
  }

  /**
   * Unset a loaded relationship
   */
  public unsetRelation(relation: string): this {
    delete this.relations[relation];
    return this as any;
  }

  /**
   * Get all the loaded relations for the instance
   */
  public getRelations(): Record<string, any> {
    return this.relations;
  }

  /**
   * Set the entire relations array on the model
   */
  public setRelations(relations: Record<string, any>): this {
    this.relations = relations;
    return this as any;
  }

  /**
   * Determine if the given relation is loaded
   */
  public relationLoaded(key: string): boolean {
    return key in this.relations;
  }

  /**
   * Load a relationship if it hasn't been loaded yet
   */
  public async load(relations: string | string[]): Promise<this> {
    const relationArray = Array.isArray(relations) ? relations : [relations];

    for (const relation of relationArray) {
      if (!this.relationLoaded(relation)) {
        const results = await this.getRelationshipFromMethod(relation).getResults();
        this.setRelation(relation, results);
      }
    }

    return this as any;
  }

  // -------------------------------------------------------------------------
  // Relationship aggregates
  // -------------------------------------------------------------------------

  /**
   * Eager load aggregate values of a relationship onto this model
   *
   * The query that writes the values is the same one `withCount` and friends
   * run after a select, so `loadCount` on a model and `withCount` on a query
   * agree on names, scopes and empty values.
   */
  protected async loadAggregate(type: string, relations: AggregateRelations, column: string = '*'): Promise<this> {
    await this.newQuery().loadAggregates([this as any], createAggregateLoads(type, relations, column));

    return this as any;
  }

  /**
   * Load the number of related rows onto this model
   */
  public async loadCount(relations: AggregateRelations): Promise<this> {
    return this.loadAggregate('count', relations);
  }

  /**
   * Load the sum of a related column onto this model
   */
  public async loadSum(relations: AggregateRelations, column: string): Promise<this> {
    return this.loadAggregate('sum', relations, column);
  }

  /**
   * Load the average of a related column onto this model
   */
  public async loadAvg(relations: AggregateRelations, column: string): Promise<this> {
    return this.loadAggregate('avg', relations, column);
  }

  /**
   * Load the smallest value of a related column onto this model
   */
  public async loadMin(relations: AggregateRelations, column: string): Promise<this> {
    return this.loadAggregate('min', relations, column);
  }

  /**
   * Load the largest value of a related column onto this model
   */
  public async loadMax(relations: AggregateRelations, column: string): Promise<this> {
    return this.loadAggregate('max', relations, column);
  }

  /**
   * Load whether this model has related rows onto it
   */
  public async loadExists(relations: AggregateRelations): Promise<this> {
    return this.loadAggregate('exists', relations);
  }

  /**
   * Eager load relations on the model
   */
  public async loadMissing(relations: string | string[]): Promise<this> {
    const relationArray = Array.isArray(relations) ? relations : [relations];
    const missing = relationArray.filter((relation) => !this.relationLoaded(relation));

    if (missing.length > 0) {
      await this.load(missing);
    }

    return this as any;
  }

  /**
   * Touch the owning relations of the model
   */
  public async touch(): Promise<boolean> {
    // TODO: Implement when we have timestamps
    return true;
  }

  /**
   * Create a new model query instance for the model
   */
  protected abstract newQuery(): EnsembleBuilder<any>;

  /**
   * Get the table name (from Ensemble)
   */
  protected abstract getTable(): string;

  /**
   * Get the primary key name (from Ensemble)
   */
  protected abstract getKeyName(): string;

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
