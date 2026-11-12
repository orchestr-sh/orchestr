/**
 * Relation Base Class
 *
 * Base class for all relationship types
 */

import { Ensemble } from '@/Database/Ensemble/Ensemble';
import { EnsembleBuilder } from '@/Database/Ensemble/EnsembleBuilder';

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
   * Run a callback with relationship constraints switched off
   *
   * Sub-selects (existence checks, aggregates) correlate the related table with
   * the parent's in their own way, so they need the relation's keys without the
   * eager-load or single-parent constraints layered on top.
   */
  static noConstraints<T>(callback: () => T): T {
    const previous = Relation.constraints;

    Relation.constraints = false;

    try {
      return callback();
    } finally {
      Relation.constraints = previous;
    }
  }

  /**
   * Correlate a fresh related query with the parent's rows
   *
   * This is the shape every existence check runs on: the relation owns the keys
   * and joins that connect its table to the parent's, so the builder can wrap
   * the result in `exists (...)` - or a counted sub-select - without knowing
   * which relation type it is looking at.
   */
  getRelationExistenceQuery(query: EnsembleBuilder<TRelated>): EnsembleBuilder<TRelated> {
    this.assertCorrelatable();
    this.constrainRelatedQuery(query);

    return query.whereColumn(this.getQualifiedParentKeyName(), '=', this.getExistenceCompareKey());
  }

  /**
   * Add the relation's own SQL shape - pivot joins, morph type restrictions -
   * to a query used as a sub-select or for aggregation. Relationships whose
   * query is a single table need nothing here.
   */
  constrainRelatedQuery(query: EnsembleBuilder<TRelated>): void {
    // Nothing beyond the related table itself.
  }

  /**
   * Name a column with the table it lives on
   *
   * Sub-selects correlate across tables, so their columns have to be qualified.
   * Keys declared with their table already (`comments.post_id`) pass through.
   */
  protected qualifyColumn(column: string, table: string = this.related.getTable()): string {
    return column.includes('.') ? column : `${table}.${column}`;
  }

  /**
   * The column an aggregate wraps, named where it lives
   *
   * `count(*)` has no column to name; every other aggregate needs the related
   * table in front of it to stay unambiguous once the query joins.
   */
  qualifyAggregateColumn(column: string): string {
    return column === '*' ? '*' : this.qualifyColumn(column);
  }

  /**
   * The column on the related side a sub-select correlates with the parent key
   */
  protected getExistenceCompareKey(): string {
    throw this.subqueryNotSupported();
  }

  /**
   * The column an aggregate groups related rows by to line them up with their
   * parents
   */
  getAggregateKeyColumn(): string {
    throw this.subqueryNotSupported();
  }

  /**
   * The parent attribute whose value `getAggregateKeyColumn()` matches
   */
  getAggregateParentKey(): string {
    throw this.subqueryNotSupported();
  }

  /**
   * Throw unless this relationship's tables can be correlated at all.
   *
   * An existence sub-select reads the outer row from inside, so a relation whose
   * related table is also the parent's own table would need a table alias to
   * stay correlated. Ensemble builders do not generate one yet, so the check
   * says so instead of quietly matching rows of the wrong query. Aggregates do
   * not correlate - they group by a key - so they are not affected.
   */
  protected assertCorrelatable(): void {
    if (this.related.getTable() === this.parent.getTable()) {
      throw new Error(
        `Relationship between [${this.parent.getTable()}] and [${this.related.getTable()}] shares its parent ` +
          'table, which a correlated existence sub-select cannot resolve without a table alias.'
      );
    }
  }

  /**
   * The error for relationship types with no single table to correlate.
   */
  protected subqueryNotSupported(): Error {
    return new Error(`Relationship [${this.constructor.name}] does not support existence or aggregate sub-queries.`);
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
   * Include trashed rows of the related model in this relation query
   */
  withTrashed(): this {
    this.query.withTrashed();
    return this;
  }

  /**
   * Return only the trashed rows of the related model
   */
  onlyTrashed(): this {
    this.query.onlyTrashed();
    return this;
  }

  /**
   * Exclude trashed rows of the related model, the default
   */
  withoutTrashed(): this {
    this.query.withoutTrashed();
    return this;
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
import { EnsembleCollection } from '@/Database/Ensemble/EnsembleCollection';
