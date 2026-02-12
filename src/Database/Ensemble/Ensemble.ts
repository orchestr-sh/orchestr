/**
 * Ensemble Class
 *
 * Base class for Ensemble models with ActiveRecord pattern
 * In Orchestr, your data models are called Ensembles - groups that work in harmony
 */

import { DatabaseManager } from '../DatabaseManager';
import { Connection } from '../Connection';
import { EnsembleBuilder } from './EnsembleBuilder';
import { HasRelationshipsMixin } from './Concerns/HasRelationships';

export abstract class Ensemble extends HasRelationshipsMixin {
  /**
   * The connection resolver instance
   */
  protected static connectionResolver: DatabaseManager;

  /**
   * The table associated with the model
   */
  protected table?: string;

  /**
   * The primary key for the model
   */
  protected primaryKey: string = 'id';

  /**
   * Indicates if the IDs are auto-incrementing
   */
  protected incrementing: boolean = true;

  /**
   * The data type of the primary key
   */
  protected keyType: string = 'int';

  /**
   * The attributes that are mass assignable
   */
  protected fillable: string[] = [];

  /**
   * The attributes that aren't mass assignable
   */
  protected guarded: string[] = ['*'];

  /**
   * The attributes that should be hidden for serialization
   */
  protected hidden: string[] = [];

  /**
   * The attributes that should be visible for serialization
   */
  protected visible: string[] = [];

  /**
   * The accessors to append to the model's array form
   */
  protected appends: string[] = [];

  /**
   * The attributes that should be cast
   */
  protected casts: Record<string, string> = {};

  /**
   * Indicates if the model should be timestamped
   */
  protected timestamps: boolean = true;

  /**
   * The name of the "created at" column
   */
  protected static CREATED_AT: string = 'created_at';

  /**
   * The name of the "updated at" column
   */
  protected static UPDATED_AT: string = 'updated_at';

  /**
   * The name of the "deleted at" column (for soft deletes)
   */
  protected static DELETED_AT: string = 'deleted_at';

  /**
   * The model's attributes
   */
  protected attributes: Record<string, any> = {};

  /**
   * The model's original attributes
   */
  protected original: Record<string, any> = {};

  /**
   * Indicates if the model exists in the database
   */
  public exists: boolean = false;

  /**
   * Indicates if the model was inserted during this request
   */
  public wasRecentlyCreated: boolean = false;

  /**
   * The connection name for the model
   */
  protected connection?: string;

  /**
   * Enable dynamic relationship access (user.posts instead of user.posts().get())
   * Set to true to enable PHP-like __get behavior for relationships
   */
  protected dynamicRelations: boolean = false;

  /**
   * Create a new Eloquent model instance
   */
  constructor(attributes: Record<string, any> = {}, fromDatabase: boolean = false) {
    super();
    if (fromDatabase) {
      // When hydrating from database, set all attributes directly
      this.setRawAttributes(attributes);
    } else {
      // When creating manually, respect fillable/guarded
      this.fill(attributes);
    }
  }

  /**
   * Fill the model with an array of attributes
   */
  fill(attributes: Record<string, any>): this {
    for (const [key, value] of Object.entries(attributes)) {
      if (this.isFillable(key)) {
        this.setAttribute(key, value);
      }
    }
    return this;
  }

  /**
   * Set a given attribute on the model
   */
  setAttribute(key: string, value: any): this {
    // Check for mutator
    const mutator = `set${this.studly(key)}Attribute`;
    if (typeof (this as any)[mutator] === 'function') {
      (this as any)[mutator](value);
      return this;
    }

    this.attributes[key] = value;
    return this;
  }

  /**
   * Set the array of model attributes (bypasses fillable/guarded)
   * Used when hydrating from database
   */
  setRawAttributes(attributes: Record<string, any>): this {
    this.attributes = attributes;
    return this;
  }

  /**
   * Get an attribute from the model
   */
  getAttribute(key: string): any {
    if (!key) {
      return undefined;
    }

    // Check if we have an accessor
    const accessor = `get${this.studly(key)}Attribute`;
    if (typeof (this as any)[accessor] === 'function') {
      return (this as any)[accessor]();
    }

    // Get the attribute value
    const value = this.attributes[key];

    // Cast the attribute if needed
    if (this.hasCast(key)) {
      return this.castAttribute(key, value);
    }

    return value;
  }

  /**
   * Determine if the given attribute may be mass assigned
   */
  protected isFillable(key: string): boolean {
    if (this.fillable.length > 0) {
      return this.fillable.includes(key);
    }

    if (this.guarded.length > 0 && !this.guarded.includes('*')) {
      return !this.guarded.includes(key);
    }

    return this.guarded[0] !== '*';
  }

  /**
   * Determine if a get mutator exists for an attribute
   */
  protected hasGetMutator(key: string): boolean {
    return typeof (this as any)[`get${this.studly(key)}Attribute`] === 'function';
  }

  /**
   * Determine if a set mutator exists for an attribute
   */
  protected hasSetMutator(key: string): boolean {
    return typeof (this as any)[`set${this.studly(key)}Attribute`] === 'function';
  }

  /**
   * Determine if a cast is defined for an attribute
   */
  protected hasCast(key: string): boolean {
    return key in this.casts;
  }

  /**
   * Cast an attribute to a native PHP type
   */
  protected castAttribute(key: string, value: any): any {
    if (value === null) {
      return value;
    }

    const castType = this.casts[key];

    switch (castType) {
      case 'int':
      case 'integer':
        return parseInt(value);
      case 'real':
      case 'float':
      case 'double':
        return parseFloat(value);
      case 'string':
        return String(value);
      case 'bool':
      case 'boolean':
        return Boolean(value);
      case 'object':
        return typeof value === 'string' ? JSON.parse(value) : value;
      case 'array':
      case 'json':
        return typeof value === 'string' ? JSON.parse(value) : value;
      case 'collection':
        return typeof value === 'string' ? JSON.parse(value) : value;
      case 'date':
      case 'datetime':
      case 'timestamp':
        return value instanceof Date ? value : new Date(value);
      default:
        return value;
    }
  }

  /**
   * Convert the model to a plain object
   */
  toObject(): Record<string, any> {
    const attributes: Record<string, any> = {};

    for (const key of Object.keys(this.attributes)) {
      if (this.isVisible(key)) {
        attributes[key] = this.getAttribute(key);
      }
    }

    // Add appended accessors
    for (const key of this.appends) {
      attributes[key] = this.getAttribute(key);
    }

    // Add loaded relationships
    for (const [key, value] of Object.entries(this.relations)) {
      if (Array.isArray(value)) {
        attributes[key] = value.map((model) => model.toObject());
      } else if (value && typeof value.toObject === 'function') {
        attributes[key] = value.toObject();
      } else {
        attributes[key] = value;
      }
    }

    return attributes;
  }

  /**
   * Convert the model to JSON
   */
  toJSON(): Record<string, any> {
    return this.toObject();
  }

  /**
   * Determine if an attribute is visible
   */
  protected isVisible(key: string): boolean {
    if (this.visible.length > 0) {
      return this.visible.includes(key);
    }

    return !this.hidden.includes(key);
  }

  /**
   * Get the table associated with the model
   */
  getTable(): string {
    if (this.table) {
      return this.table;
    }

    // Convert class name to snake_case plural
    // e.g., User -> users, BlogPost -> blog_posts
    const className = this.constructor.name;
    return this.pluralize(this.snake(className));
  }

  /**
   * Get the primary key for the model
   */
  getKeyName(): string {
    return this.primaryKey;
  }

  /**
   * Get the value of the model's primary key
   */
  getKey(): any {
    return this.getAttribute(this.getKeyName());
  }

  /**
   * Set the connection resolver instance
   */
  static setConnectionResolver(resolver: DatabaseManager): void {
    (Ensemble as any).connectionResolver = resolver;
  }

  /**
   * Get the database connection for the model
   */
  getConnection(): Connection {
    return (this.constructor as typeof Ensemble).connectionResolver.connection(this.connection);
  }

  /**
   * Begin querying the model
   */
  static query<T extends Ensemble>(this: { new (): T }): EnsembleBuilder<T> {
    const instance = new this();
    return new EnsembleBuilder<T>(instance.getConnection().getAdapter(), instance);
  }

  /**
   * Get all of the models from the database
   */
  static async all<T extends Ensemble>(this: { new (): T }, columns: string[] = ['*']): Promise<T[]> {
    return (this as any)
      .query()
      .select(...columns)
      .get();
  }

  /**
   * Find a model by its primary key
   */
  static async find<T extends Ensemble>(this: { new (): T }, id: any, columns: string[] = ['*']): Promise<T | null> {
    return (this as any)
      .query()
      .select(...columns)
      .find(id);
  }

  /**
   * Find a model by its primary key or throw an exception
   */
  static async findOrFail<T extends Ensemble>(this: { new (): T }, id: any, columns: string[] = ['*']): Promise<T> {
    const model = await (this as any).find(id, columns);
    if (!model) {
      throw new Error(`Ensemble not found with id: ${id}`);
    }
    return model;
  }

  /**
   * Find multiple models by their primary keys
   */
  static async findMany<T extends Ensemble>(this: { new (): T }, ids: any[], columns: string[] = ['*']): Promise<T[]> {
    const instance = new this();
    return (this as any)
      .query()
      .select(...columns)
      .whereIn(instance.getKeyName(), ids)
      .get();
  }

  /**
   * Create a new instance and save it to the database
   */
  static async create<T extends Ensemble>(
    this: { new (attrs?: Record<string, any>): T },
    attributes: Record<string, any>
  ): Promise<T> {
    const instance = new this(attributes);
    await instance.save();
    return instance;
  }

  /**
   * Update or create a model matching the attributes
   */
  static async updateOrCreate<T extends Ensemble>(
    this: { new (): T },
    attributes: Record<string, any>,
    values: Record<string, any> = {}
  ): Promise<T> {
    const instance = await (this as any).query().where(attributes).first();

    if (instance) {
      instance.fill(values);
      await instance.save();
      return instance;
    }

    return (this as any).create({ ...attributes, ...values });
  }

  /**
   * Save the model to the database
   */
  async save(): Promise<boolean> {
    if (this.exists) {
      return this.performUpdate();
    }

    return this.performInsert();
  }

  /**
   * Perform a model insert operation
   */
  protected async performInsert(): Promise<boolean> {
    const attributes = this.getAttributesForInsert();

    if (this.timestamps) {
      this.updateTimestamps();
    }

    const connection = this.getConnection();
    const table = this.getTable();

    const id = await connection.table(table).insertGetId(attributes);

    if (this.incrementing) {
      this.setAttribute(this.getKeyName(), id);
    }

    this.exists = true;
    this.wasRecentlyCreated = true;
    this.syncOriginal();

    return true;
  }

  /**
   * Perform a model update operation
   */
  protected async performUpdate(): Promise<boolean> {
    const dirty = this.getDirty();

    if (Object.keys(dirty).length === 0) {
      return true;
    }

    if (this.timestamps) {
      this.updateTimestamps();
    }

    const connection = this.getConnection();
    const table = this.getTable();

    await connection.table(table).where(this.getKeyName(), '=', this.getKey()).update(dirty);

    this.syncOriginal();

    return true;
  }

  /**
   * Update the model's timestamps
   */
  protected updateTimestamps(): void {
    const time = new Date();

    const updatedAtColumn = (this.constructor as typeof Ensemble).UPDATED_AT;
    if (updatedAtColumn && !this.isDirty(updatedAtColumn)) {
      this.setAttribute(updatedAtColumn, time);
    }

    const createdAtColumn = (this.constructor as typeof Ensemble).CREATED_AT;
    if (!this.exists && createdAtColumn && !this.isDirty(createdAtColumn)) {
      this.setAttribute(createdAtColumn, time);
    }
  }

  /**
   * Get the attributes that have been changed
   */
  getDirty(): Record<string, any> {
    const dirty: Record<string, any> = {};

    for (const [key, value] of Object.entries(this.attributes)) {
      if (!this.originalIsEquivalent(key, value)) {
        dirty[key] = value;
      }
    }

    return dirty;
  }

  /**
   * Determine if the given attribute has been changed
   */
  isDirty(attribute?: string): boolean {
    if (!attribute) {
      return Object.keys(this.getDirty()).length > 0;
    }

    return attribute in this.getDirty();
  }

  /**
   * Determine if the original value is equivalent to the current value
   */
  protected originalIsEquivalent(key: string, current: any): boolean {
    if (!(key in this.original)) {
      return false;
    }

    const original = this.original[key];

    if (current === original) {
      return true;
    }

    if (current === null) {
      return false;
    }

    if (this.isDateAttribute(key)) {
      return this.compareDates(current, original);
    }

    return String(current) === String(original);
  }

  /**
   * Determine if the given attribute is a date or date castable
   */
  protected isDateAttribute(key: string): boolean {
    const cast = this.casts[key];
    return cast === 'date' || cast === 'datetime' || cast === 'timestamp';
  }

  /**
   * Compare two dates
   */
  protected compareDates(current: any, original: any): boolean {
    const currentDate = current instanceof Date ? current : new Date(current);
    const originalDate = original instanceof Date ? original : new Date(original);
    return currentDate.getTime() === originalDate.getTime();
  }

  /**
   * Get the attributes for insert
   */
  protected getAttributesForInsert(): Record<string, any> {
    return { ...this.attributes };
  }

  /**
   * Sync the original attributes with the current
   */
  protected syncOriginal(): this {
    this.original = { ...this.attributes };
    return this;
  }

  /**
   * Delete the model from the database
   */
  async delete(): Promise<boolean> {
    if (!this.exists) {
      return false;
    }

    const connection = this.getConnection();
    const table = this.getTable();

    await connection.table(table).where(this.getKeyName(), '=', this.getKey()).delete();

    this.exists = false;

    return true;
  }

  /**
   * Reload the current model instance from the database
   */
  async refresh(): Promise<this> {
    if (!this.exists) {
      return this;
    }

    const fresh = await (this.constructor as any).find(this.getKey());

    if (!fresh) {
      throw new Error('Ensemble not found');
    }

    this.attributes = (fresh as any).attributes;
    this.syncOriginal();

    return this;
  }

  /**
   * Convert a string to studly case
   */
  protected studly(value: string): string {
    return value
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join('');
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

  /**
   * Pluralize a string (simple implementation)
   */
  protected pluralize(value: string): string {
    if (value.endsWith('y')) {
      return value.slice(0, -1) + 'ies';
    }
    if (value.endsWith('s')) {
      return value + 'es';
    }
    return value + 's';
  }

  /**
   * Create a new query instance for the model
   */
  newQuery(): EnsembleBuilder<any> {
    return (this.constructor as any).query();
  }

  /**
   * Create a new instance of the given model
   */
  newInstance(attributes: Record<string, any> = {}, exists: boolean = false): this {
    const ModelClass = this.constructor as new (attributes: Record<string, any>, fromDatabase: boolean) => this;
    const instance = new ModelClass(attributes, exists);
    instance.exists = exists;

    if (exists) {
      instance.syncOriginal();
    }

    return instance;
  }

  /**
   * Get the name of the "updated at" column
   */
  getUpdatedAtColumn(): string | null {
    return this.timestamps ? (this.constructor as typeof Ensemble).UPDATED_AT : null;
  }

  /**
   * Get the name of the "created at" column
   */
  getCreatedAtColumn(): string | null {
    return this.timestamps ? (this.constructor as typeof Ensemble).CREATED_AT : null;
  }
}
