/**
 * Relation Base Class
 *
 * Base class for all relationship types
 */

import { Ensemble } from '../Ensemble';
import { EnsembleBuilder } from '../EnsembleBuilder';

export abstract class Relation<TRelated extends Ensemble, TParent extends Ensemble = Ensemble> {
  /**
   * The Ensemble query builder instance
   */
  protected query: EnsembleBuilder<TRelated>;

  /**
   * The parent Ensemble instance
   */
  protected parent: TParent;

  /**
   * The related Ensemble instance
   */
  protected related: TRelated;

  /**
   * Indicates if the relation is adding constraints
   */
  protected static constraints = true;

  /**
   * Indicates if constraints have been applied
   */
  protected constraintsApplied = false;

  /**
   * Create a new relation instance
   */
  constructor(query: EnsembleBuilder<TRelated>, parent: TParent) {
    this.query = query;
    this.parent = parent;
    this.related = query['model'];
  }

  /**
   * Initialize the relation and prepare for constraint application
   * Should be called by child classes after setting their properties
   */
  protected initializeRelation(): void {
    // Don't apply constraints here - they will be applied when query executes
  }

  /**
   * Ensure constraints are applied before executing the query
   */
  protected ensureConstraints(): void {
    if (!this.constraintsApplied && Relation['constraints']) {
      this.addConstraints();
      this.constraintsApplied = true;
    }
  }

  /**
   * Set the base constraints on the relation query
   */
  abstract addConstraints(): void;

  /**
   * Set the constraints for an eager load of the relation
   */
  abstract addEagerConstraints(models: TParent[]): void;

  /**
   * Initialize the relation on a set of models
   */
  abstract initRelation(models: TParent[], relation: string): TParent[];

  /**
   * Match the eagerly loaded results to their parents
   */
  abstract match(models: TParent[], results: EnsembleCollection<TRelated>, relation: string): TParent[];

  /**
   * Get the results of the relationship
   */
  abstract getResults(): Promise<TRelated | TRelated[] | null>;

  /**
   * Execute the query as a "select" statement
   */
  async get(): Promise<TRelated[]> {
    this.ensureConstraints();
    return this.query.get();
  }

  /**
   * Get the relationship for eager loading
   */
  async getEager(): Promise<TRelated[]> {
    return this.get();
  }

  /**
   * Touch all of the related models for the relationship
   */
  async touch(): Promise<void> {
    const column = this.related.getUpdatedAtColumn();

    if (column) {
      await this.rawUpdate({ [column]: new Date() });
    }
  }

  /**
   * Run a raw update against the base query
   */
  async rawUpdate(attributes: Record<string, any> = {}): Promise<number> {
    return this.query.update(attributes);
  }

  /**
   * Get all of the primary keys for an array of models
   */
  protected getKeys(models: TParent[], key?: string): any[] {
    return models
      .map((model) => {
        const value = key ? model.getAttribute(key) : model.getKey();
        return value;
      })
      .filter((value) => value !== null && value !== undefined);
  }

  /**
   * Get the underlying query for the relation
   */
  getQuery(): EnsembleBuilder<TRelated> {
    return this.query;
  }

  /**
   * Get the base query builder driving the Ensemble builder
   */
  getBaseQuery() {
    return this.query;
  }

  /**
   * Get the parent model of the relation
   */
  getParent(): TParent {
    return this.parent;
  }

  /**
   * Get the related model of the relation
   */
  getRelated(): TRelated {
    return this.related;
  }

  /**
   * Get the name of the "created at" column
   */
  createdAt(): string {
    return this.related.getCreatedAtColumn() || 'created_at';
  }

  /**
   * Get the name of the "updated at" column
   */
  updatedAt(): string {
    return this.related.getUpdatedAtColumn() || 'updated_at';
  }

  /**
   * Get the fully qualified related table name
   */
  protected getRelatedTable(): string {
    return this.related.getTable();
  }

  /**
   * Get the fully qualified parent key name
   */
  protected getQualifiedParentKeyName(): string {
    return `${this.parent.getTable()}.${this.parent.getKeyName()}`;
  }

  /**
   * Get the fully qualified foreign key name
   */
  protected getQualifiedForeignKeyName(foreignKey: string): string {
    return `${this.related.getTable()}.${foreignKey}`;
  }

  /**
   * Handle dynamic method calls to the relationship
   */
  __call(method: string, parameters: any[]): any {
    const result = (this.query as any)[method](...parameters);

    if (result === this.query) {
      return this;
    }

    return result;
  }
}

/**
 * Import EnsembleCollection - imported at bottom to avoid circular dependency
 */
import { EnsembleCollection } from '../EnsembleCollection';
