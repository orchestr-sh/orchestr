/**
 * BelongsToMany Relationship
 *
 * Represents a many-to-many relationship
 */

import { Ensemble } from '../Ensemble';
import { EnsembleBuilder } from '../EnsembleBuilder';
import { EnsembleCollection } from '../EnsembleCollection';
import { Relation } from './Relation';

export class BelongsToMany<TRelated extends Ensemble, TParent extends Ensemble> extends Relation<TRelated, TParent> {
  /**
   * The intermediate table for the relation
   */
  protected table: string;

  /**
   * The foreign key of the parent model
   */
  protected foreignPivotKey: string;

  /**
   * The associated key of the relation
   */
  protected relatedPivotKey: string;

  /**
   * The parent key of the relationship
   */
  protected parentKey: string;

  /**
   * The related key of the relationship
   */
  protected relatedKey: string;

  /**
   * The name of the relationship
   */
  protected relationName: string;

  /**
   * The pivot table columns to retrieve
   */
  protected pivotColumns: string[] = [];

  /**
   * Any pivot table restrictions
   */
  protected pivotWheres: Array<{ column: string; operator?: string; value?: any; boolean: string }> = [];

  /**
   * The pivot table values to attach
   */
  protected pivotValues: Record<string, any>[] = [];

  /**
   * Whether we are using timestamps on the pivot table
   */
  protected usingTimestamps: boolean = false;

  /**
   * The custom pivot table model
   */
  protected using?: any;

  /**
   * The name of the "created at" column
   */
  protected pivotCreatedAt?: string;

  /**
   * The name of the "updated at" column
   */
  protected pivotUpdatedAt?: string;

  /**
   * The name of the accessor to use for the pivot relationship
   */
  protected accessor: string = 'pivot';

  /**
   * Create a new belongs to many relationship instance
   */
  constructor(
    query: EnsembleBuilder<TRelated>,
    parent: TParent,
    table: string,
    foreignPivotKey: string,
    relatedPivotKey: string,
    parentKey: string,
    relatedKey: string,
    relationName?: string
  ) {
    super(query, parent);
    this.table = table;
    this.foreignPivotKey = foreignPivotKey;
    this.relatedPivotKey = relatedPivotKey;
    this.parentKey = parentKey;
    this.relatedKey = relatedKey;
    this.relationName = relationName || '';
    this.initializeRelation();
  }

  /**
   * Set the base constraints on the relation query
   */
  addConstraints(): void {
    this.performJoin();

    if (Relation['constraints']) {
      this.addWhereConstraints();
    }
  }

  /**
   * Set the join clause for the relation query
   */
  protected performJoin(query?: EnsembleBuilder<TRelated>): void {
    query = query || this.query;

    // Join the pivot table on the related key
    query.join(
      this.table,
      `${this.getQualifiedRelatedKeyName()}`,
      '=',
      `${this.getQualifiedRelatedPivotKeyName()}`
    );
  }

  /**
   * Set the where clause for the relation query
   */
  protected addWhereConstraints(): void {
    this.query.where(
      this.getQualifiedForeignPivotKeyName(),
      '=',
      this.parent.getAttribute(this.parentKey)
    );
  }

  /**
   * Set the constraints for an eager load of the relation
   */
  addEagerConstraints(models: TParent[]): void {
    const keys = this.getKeys(models, this.parentKey);
    this.query.whereIn(this.getQualifiedForeignPivotKeyName(), keys);
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
      const key = model.getAttribute(this.parentKey);

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
      const pivotAttributes = this.migratePivotAttributes(result);
      const key = pivotAttributes[this.foreignPivotKey];

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
    const parentKey = this.parent.getAttribute(this.parentKey);

    if (!parentKey) {
      return [];
    }

    return this.get();
  }

  /**
   * Execute the query and get the models
   */
  async get(): Promise<TRelated[]> {
    const builder = this.query.addSelect(...this.shouldSelect());

    const models = await builder.get();

    this.hydratePivotRelation(models);

    return models;
  }

  /**
   * Get the select columns for the relation query
   */
  protected shouldSelect(columns: string[] = ['*']): string[] {
    if (columns.length === 1 && columns[0] === '*') {
      columns = [`${this.related.getTable()}.*`];
    }

    return [...columns, ...this.aliasedPivotColumns()];
  }

  /**
   * Get the pivot columns for the relation
   */
  protected aliasedPivotColumns(): string[] {
    const defaults = [this.foreignPivotKey, this.relatedPivotKey];
    const columns = [...defaults, ...this.pivotColumns];

    return columns.map((column) => {
      return `${this.table}.${column} as pivot_${column}`;
    });
  }

  /**
   * Hydrate the pivot relationship on the models
   */
  protected hydratePivotRelation(models: TRelated[]): void {
    for (const model of models) {
      const pivot = this.migratePivotAttributes(model);
      model.setRelation(this.accessor, pivot);
    }
  }

  /**
   * Migrate the pivot attributes from the model to a pivot model
   */
  protected migratePivotAttributes(model: TRelated): Record<string, any> {
    const values: Record<string, any> = {};

    // Extract all pivot_* attributes
    const attributes = (model as any).attributes || {};
    for (const [key, value] of Object.entries(attributes)) {
      if (key.startsWith('pivot_')) {
        const pivotKey = key.substring(6); // Remove 'pivot_' prefix
        values[pivotKey] = value;
        delete (model as any).attributes[key];
      }
    }

    return values;
  }

  /**
   * Get the fully qualified foreign key for the relation
   */
  protected getQualifiedForeignPivotKeyName(): string {
    return `${this.table}.${this.foreignPivotKey}`;
  }

  /**
   * Get the fully qualified "related key" for the relation
   */
  protected getQualifiedRelatedPivotKeyName(): string {
    return `${this.table}.${this.relatedPivotKey}`;
  }

  /**
   * Get the fully qualified parent key name
   */
  protected getQualifiedParentKeyName(): string {
    return `${this.parent.getTable()}.${this.parentKey}`;
  }

  /**
   * Get the fully qualified related key name
   */
  protected getQualifiedRelatedKeyName(): string {
    return `${this.related.getTable()}.${this.relatedKey}`;
  }

  /**
   * Specify the pivot table columns to retrieve
   */
  withPivot(...columns: string[]): this {
    this.pivotColumns = [
      ...this.pivotColumns,
      ...columns,
    ];

    return this;
  }

  /**
   * Indicate that the pivot table has timestamps
   */
  withTimestamps(createdAt?: string, updatedAt?: string): this {
    this.usingTimestamps = true;

    this.pivotCreatedAt = createdAt || 'created_at';
    this.pivotUpdatedAt = updatedAt || 'updated_at';

    return this.withPivot(this.pivotCreatedAt, this.pivotUpdatedAt);
  }

  /**
   * Set a where clause for the pivot table
   */
  wherePivot(column: string, operator?: any, value?: any): this {
    if (arguments.length === 2) {
      value = operator;
      operator = '=';
    }

    this.pivotWheres.push({
      column: `${this.table}.${column}`,
      operator,
      value,
      boolean: 'and',
    });

    return this.query.where(`${this.table}.${column}`, operator, value) as any;
  }

  /**
   * Set a "where in" clause for the pivot table
   */
  wherePivotIn(column: string, values: any[]): this {
    return this.query.whereIn(`${this.table}.${column}`, values) as any;
  }

  /**
   * Set a "where not in" clause for the pivot table
   */
  wherePivotNotIn(column: string, values: any[]): this {
    return this.query.whereNotIn(`${this.table}.${column}`, values) as any;
  }

  /**
   * Set a "where null" clause for the pivot table
   */
  wherePivotNull(column: string): this {
    return this.query.whereNull(`${this.table}.${column}`) as any;
  }

  /**
   * Set a "where not null" clause for the pivot table
   */
  wherePivotNotNull(column: string): this {
    return this.query.whereNotNull(`${this.table}.${column}`) as any;
  }

  /**
   * Set an "or where" clause for the pivot table
   */
  orWherePivot(column: string, operator?: any, value?: any): this {
    if (arguments.length === 2) {
      value = operator;
      operator = '=';
    }

    return this.query.orWhere(`${this.table}.${column}`, operator, value) as any;
  }

  /**
   * Attach models to the parent
   */
  async attach(ids: any | any[], attributes: Record<string, any> = {}): Promise<void> {
    const records = this.formatAttachRecords(
      this.parseIds(ids),
      attributes
    );

    if (records.length === 0) {
      return;
    }

    const connection = this.parent.getConnection();
    await connection.table(this.table).insert(records);
  }

  /**
   * Detach models from the parent
   */
  async detach(ids?: any | any[]): Promise<number> {
    const connection = this.parent.getConnection();
    let query = connection.table(this.table).where(
      this.foreignPivotKey,
      '=',
      this.parent.getAttribute(this.parentKey)
    );

    if (ids !== undefined) {
      const parsedIds = this.parseIds(ids);
      query = query.whereIn(this.relatedPivotKey, parsedIds);
    }

    return await query.delete();
  }

  /**
   * Sync the intermediate tables with a list of IDs
   */
  async sync(ids: any | any[] | Record<number | string, Record<string, any>>): Promise<{
    attached: any[];
    detached: any[];
    updated: any[];
  }> {
    const changes = {
      attached: [] as any[],
      detached: [] as any[],
      updated: [] as any[],
    };

    const current = await this.getCurrentlyAttachedPivots();
    const records = this.formatRecordsList(this.parseIds(ids));

    const detach = current.filter(
      (id) => !records.some((record) => record.id === id)
    );

    if (detach.length > 0) {
      await this.detach(detach);
      changes.detached = detach;
    }

    changes.attached = await this.attachNew(records, current);
    changes.updated = await this.updateExisting(records, current);

    return changes;
  }

  /**
   * Sync without detaching
   */
  async syncWithoutDetaching(ids: any | any[] | Record<number | string, Record<string, any>>): Promise<{
    attached: any[];
    updated: any[];
  }> {
    const changes = {
      attached: [] as any[],
      updated: [] as any[],
    };

    const current = await this.getCurrentlyAttachedPivots();
    const records = this.formatRecordsList(this.parseIds(ids));

    changes.attached = await this.attachNew(records, current);
    changes.updated = await this.updateExisting(records, current);

    return changes;
  }

  /**
   * Toggle models from the parent
   */
  async toggle(ids: any | any[]): Promise<{
    attached: any[];
    detached: any[];
  }> {
    const changes = {
      attached: [] as any[],
      detached: [] as any[],
    };

    const parsedIds = this.parseIds(ids);
    const current = await this.getCurrentlyAttachedPivots();

    const detach = parsedIds.filter((id) => current.includes(id));
    const attach = parsedIds.filter((id) => !current.includes(id));

    if (detach.length > 0) {
      await this.detach(detach);
      changes.detached = detach;
    }

    if (attach.length > 0) {
      await this.attach(attach);
      changes.attached = attach;
    }

    return changes;
  }

  /**
   * Update an existing pivot record on the table
   */
  async updateExistingPivot(id: any, attributes: Record<string, any>): Promise<number> {
    if (this.usingTimestamps && this.pivotUpdatedAt) {
      attributes[this.pivotUpdatedAt] = new Date();
    }

    const connection = this.parent.getConnection();
    return await connection
      .table(this.table)
      .where(this.foreignPivotKey, '=', this.parent.getAttribute(this.parentKey))
      .where(this.relatedPivotKey, '=', id)
      .update(attributes);
  }

  /**
   * Get the currently attached pivot IDs
   */
  protected async getCurrentlyAttachedPivots(): Promise<any[]> {
    const connection = this.parent.getConnection();
    const results = await connection
      .table(this.table)
      .where(this.foreignPivotKey, '=', this.parent.getAttribute(this.parentKey))
      .pluck(this.relatedPivotKey);

    return results;
  }

  /**
   * Attach new records
   */
  protected async attachNew(
    records: Array<{ id: any; attributes: Record<string, any> }>,
    current: any[]
  ): Promise<any[]> {
    const newRecords = records.filter((record) => !current.includes(record.id));

    if (newRecords.length === 0) {
      return [];
    }

    await this.attach(
      newRecords.map((r) => r.id),
      newRecords[0]?.attributes || {}
    );

    return newRecords.map((r) => r.id);
  }

  /**
   * Update existing records
   */
  protected async updateExisting(
    records: Array<{ id: any; attributes: Record<string, any> }>,
    current: any[]
  ): Promise<any[]> {
    const updated: any[] = [];

    for (const record of records) {
      if (current.includes(record.id) && Object.keys(record.attributes).length > 0) {
        await this.updateExistingPivot(record.id, record.attributes);
        updated.push(record.id);
      }
    }

    return updated;
  }

  /**
   * Format the records for attaching
   */
  protected formatAttachRecords(ids: any[], attributes: Record<string, any>): Record<string, any>[] {
    const records: Record<string, any>[] = [];
    const hasTimestamps = this.usingTimestamps;

    for (const id of ids) {
      const record: Record<string, any> = {
        [this.foreignPivotKey]: this.parent.getAttribute(this.parentKey),
        [this.relatedPivotKey]: id,
        ...attributes,
      };

      if (hasTimestamps) {
        const now = new Date();
        if (this.pivotCreatedAt) {
          record[this.pivotCreatedAt] = now;
        }
        if (this.pivotUpdatedAt) {
          record[this.pivotUpdatedAt] = now;
        }
      }

      records.push(record);
    }

    return records;
  }

  /**
   * Format the sync records
   */
  protected formatRecordsList(ids: any[]): Array<{ id: any; attributes: Record<string, any> }> {
    return ids.map((id) => {
      if (typeof id === 'object' && !Array.isArray(id)) {
        const { id: recordId, ...attributes } = id;
        return { id: recordId, attributes };
      }
      return { id, attributes: {} };
    });
  }

  /**
   * Parse the IDs from the given value
   */
  protected parseIds(value: any): any[] {
    if (value instanceof EnsembleCollection) {
      return value.modelKeys();
    }

    if (Array.isArray(value)) {
      return value;
    }

    if (typeof value === 'object' && value !== null) {
      // Handle {id: attributes} format
      return Object.keys(value).map((key) => {
        const id = isNaN(Number(key)) ? key : Number(key);
        return { id, ...value[key] };
      });
    }

    return [value];
  }

  /**
   * Get the name of the pivot accessor
   */
  getPivotAccessor(): string {
    return this.accessor;
  }

  /**
   * Set the name of the pivot accessor
   */
  as(accessor: string): this {
    this.accessor = accessor;
    return this;
  }

  /**
   * Get the pivot table name
   */
  getTable(): string {
    return this.table;
  }

  /**
   * Get the foreign pivot key name
   */
  getForeignPivotKeyName(): string {
    return this.foreignPivotKey;
  }

  /**
   * Get the related pivot key name
   */
  getRelatedPivotKeyName(): string {
    return this.relatedPivotKey;
  }

  /**
   * Get the parent key name
   */
  getParentKeyName(): string {
    return this.parentKey;
  }

  /**
   * Get the related key name
   */
  getRelatedKeyName(): string {
    return this.relatedKey;
  }

  /**
   * Get the relationship name
   */
  getRelationName(): string {
    return this.relationName;
  }
}
