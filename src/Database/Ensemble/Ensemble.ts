/**
 * Ensemble Class
 *
 * Base class for Ensemble models with ActiveRecord pattern
 * In Orchestr, your data models are called Ensembles - groups that work in harmony
 */

import type { EnsembleClass, Factory, FactoryState } from '@/Database/Factories/Factory';
import type { Encrypter as CrypterContract } from '@/Encryption/Contracts/Encrypter';
import { Connection } from '@/Database/Connection';
import { DatabaseManager } from '@/Database/DatabaseManager';
import { resolveModelFactory } from '@/Database/Factories/HasFactory';
import { getGlobalApp } from '@/Support/helpers';
import type { SoftDeletes } from './SoftDeletes';
import { HasRelationshipsMixin } from './Concerns/HasRelationships';
import { EnsembleBuilder } from './EnsembleBuilder';
import {
  ModelRetrieved,
  ModelCreating,
  ModelCreated,
  ModelUpdating,
  ModelUpdated,
  ModelSaving,
  ModelSaved,
  ModelDeleting,
  ModelDeleted,
  ModelSoftDeleting,
  ModelSoftDeleted,
  ModelRestoring,
  ModelRestored,
  ModelForceDeleting,
  ModelForceDeleted,
} from './Events';
import { GlobalScopeRegistry } from './GlobalScopeRegistry';
import { ObserverRegistry, type ObserverRegistration } from './Observers';
import { type AnyGlobalScope } from './Scope';

/**
 * Events the dispatcher halts on: a listener returning `false` aborts the
 * operation. `ObserverRegistry` keeps the matching list for observer hooks.
 */
const HALTING_MODEL_EVENTS = ['creating', 'updating', 'saving', 'deleting', 'restoring', 'forceDeleting'];

export abstract class Ensemble extends HasRelationshipsMixin implements SoftDeletes {
  /**
   * The connection resolver instance
   */
  protected static connectionResolver: DatabaseManager;

  /**
   * The crypter resolver used by `encrypted` casts, when one was installed
   * explicitly through Ensemble.encryptUsing()
   */
  protected static cryptResolver: (() => CrypterContract) | null = null;

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
   * The attributes that are mass assignable (instance property).
   *
   * Subclasses may also declare `static fillable: string[]` instead.
   * Static properties are resolved at construction time so they are safe
   * to use even when a subclass constructor has not yet run its own field
   * initialisers.
   */
  protected fillable: string[] = [];

  /**
   * The attributes that aren't mass assignable (instance property).
   *
   * Subclasses may also declare `static guarded: string[]` instead of
   * (or in addition to) the instance property.
   */
  protected guarded: string[] = ['*'];

  /**
   * Static fillable list.  Subclasses that declare `static fillable` here
   * will have those attributes made mass-assignable without needing a
   * constructor override.
   */
  static fillable?: string[];

  /**
   * Static guarded list.  Subclasses that declare `static guarded` here
   * will have those attributes protected from mass assignment without
   * needing a constructor override.
   */
  static guarded?: string[];

  /**
   * Static casts map. Like `static fillable`, a `static casts` declaration
   * resolves before subclass field initialisers run, so the constructor's
   * `fill()` - and therefore `Model.create({...})` - already sees the
   * `encrypted` cast.
   */
  static casts?: Record<string, string>;

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
   * Indicates if the model soft deletes. Subclasses opt in with
   * `protected static softDeletes = true`, which makes `delete()` stamp the
   * `deleted_at` column instead of removing the row and registers the
   * `SoftDeletingScope` on every query for the model.
   */
  protected static softDeletes: boolean = false;

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
   * Indicates if the model is currently being force deleted. Set by
   * `forceDelete()` so the shared delete path issues a hard `DELETE` even on
   * soft-deleting models.
   */
  public forceDeleting: boolean = false;

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

    // Encrypted casts store the ciphertext; the plaintext only ever comes
    // back out through getAttribute(), the way Laravel's encrypted casts
    // keep the raw attribute encrypted at rest
    if (this.castType(key) === 'encrypted') {
      this.attributes[key] = this.encryptAttribute(value);
      return this;
    }

    this.attributes[key] = value;
    return this;
  }

  /**
   * Record a value the query computed for this row
   *
   * Relationship aggregates are read-only results rather than model changes,
   * so the original attributes take the value alongside the current ones:
   * `getDirty()` never reports a computed column and a later `save()` never
   * tries to write one back to the table.
   */
  setComputedAttribute(key: string, value: any): this {
    this.attributes[key] = value;
    this.original[key] = value;
    return this;
  }

  /**
   * Encrypt an attribute value for storage, leaving already-encrypted
   * payloads untouched so copying raw attributes never double-encrypts
   * Laravel: HasAttributes::castAttributeAsEncryptedString()
   */
  protected encryptAttribute(value: any): any {
    if (value === null || value === undefined) {
      return value;
    }

    if (typeof value === 'string' && this.isEncryptedPayload(value)) {
      return value;
    }

    return this.crypter().encrypt(value);
  }

  /**
   * Whether a string decrypts with the application key, marking it as an
   * existing encrypted payload rather than a new plaintext value
   */
  protected isEncryptedPayload(value: string): boolean {
    try {
      this.crypter().decrypt(value, false);
      return true;
    } catch {
      return false;
    }
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
   * Determine if the given attribute may be mass assigned.
   *
   * Resolution order for `fillable` and `guarded`:
   *   1. Static property on the concrete class (e.g. `static fillable = [...]`)
   *      – safe because static properties exist before any constructor runs.
   *   2. Instance property (`this.fillable` / `this.guarded`) – populated either
   *      by Ensemble's own field initialiser or by a subclass constructor
   *      workaround that calls `this.fill()` a second time after `super()`.
   *
   * If the concrete class defines `static fillable`, it takes full precedence
   * over the instance property (matching Laravel's behaviour where a non-empty
   * fillable list is the authoritative allow-list).
   */
  protected isFillable(key: string): boolean {
    const ctor = this.constructor as typeof Ensemble;

    // Prefer static fillable if the subclass has defined one on itself
    // (not inherited – check own property to avoid reading Ensemble's
    //  `undefined` declaration as a truthy value).
    const staticFillable: string[] | undefined = Object.prototype.hasOwnProperty.call(ctor, 'fillable')
      ? ctor.fillable
      : undefined;

    const effectiveFillable: string[] = staticFillable ?? this.fillable;

    if (effectiveFillable.length > 0) {
      return effectiveFillable.includes(key);
    }

    // No fillable list – fall back to guarded logic.
    const staticGuarded: string[] | undefined = Object.prototype.hasOwnProperty.call(ctor, 'guarded')
      ? ctor.guarded
      : undefined;

    const effectiveGuarded: string[] = staticGuarded ?? this.guarded;

    if (effectiveGuarded.length > 0 && !effectiveGuarded.includes('*')) {
      return !effectiveGuarded.includes(key);
    }

    return effectiveGuarded[0] !== '*';
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
    return this.castType(key) !== undefined;
  }

  /**
   * The cast type applied to an attribute, if any.
   *
   * Soft-deleting models always cast the deleted-at column to a date, the way
   * Laravel merges it into the model's date casts, even when the subclass
   * declares no explicit cast for it.
   *
   * A `static casts` map on the concrete class wins over the instance
   * property, mirroring `static fillable`: it already exists while the
   * base constructor is filling attributes, so encrypted casts are applied
   * by `Model.create({...})` and not only by later `setAttribute()` calls.
   */
  protected castType(key: string): string | undefined {
    const ctor = this.constructor as typeof Ensemble;

    const staticCasts: Record<string, string> | undefined = Object.prototype.hasOwnProperty.call(ctor, 'casts')
      ? ctor.casts
      : undefined;

    if (staticCasts && key in staticCasts) {
      return staticCasts[key];
    }

    if (key in this.casts) {
      return this.casts[key];
    }

    if (this.usesSoftDeletes() && key === this.getDeletedAtColumn()) {
      return 'datetime';
    }

    return undefined;
  }

  /**
   * Cast an attribute to a native PHP type
   *
   * Absent and null values pass through untouched: casting `undefined` would
   * invent data (an Invalid `Date`, say) where the model simply has nothing.
   */
  protected castAttribute(key: string, value: any): any {
    if (value === null || value === undefined) {
      return value;
    }

    const castType = this.castType(key);

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
      case 'encrypted':
        return this.crypter().decrypt(value);
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
   * Get the data type of the primary key
   */
  getKeyType(): string {
    return this.keyType;
  }

  /**
   * Get the name of the route key used for implicit binding
   * Laravel: getRouteKeyName() - defaults to the primary key
   */
  getRouteKeyName(): string {
    return this.getKeyName();
  }

  /**
   * Get the value of the model's route key
   * Laravel: getRouteKey()
   */
  getRouteKey(): any {
    return this.getAttribute(this.getRouteKeyName());
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
   * Provide the crypter used by `encrypted` casts
   *
   * The EncryptionServiceProvider wires this automatically through the
   * container; apps building an Encrypter by hand - or tests that want a
   * deterministic crypter - can install one directly. Passing null clears
   * the resolver again.
   *
   * Laravel: Model::encryptUsing()
   */
  static encryptUsing(crypter: CrypterContract | (() => CrypterContract) | null): void {
    if (crypter === null) {
      (Ensemble as any).cryptResolver = null;
      return;
    }

    const factory = typeof crypter === 'function' ? (crypter as () => CrypterContract) : () => crypter;
    (Ensemble as any).cryptResolver = factory;
  }

  /**
   * The crypter encrypted casts run through: the resolver installed with
   * encryptUsing(), else the container's 'encrypter' binding
   */
  protected crypter(): CrypterContract {
    if (Ensemble.cryptResolver) {
      return Ensemble.cryptResolver();
    }

    const app = getGlobalApp();

    if (app && app.bound('encrypter')) {
      return app.make<CrypterContract>('encrypter');
    }

    throw new Error(
      'A crypter is required for encrypted casts. Register the EncryptionServiceProvider or call Ensemble.encryptUsing().'
    );
  }

  /**
   * Begin querying the model
   */
  static query<T extends Ensemble>(this: { new (): T }): EnsembleBuilder<T> {
    const instance = new this();
    const connection = instance.getConnection();

    return new EnsembleBuilder<T>(connection.getAdapter(), connection.getGrammar(), instance);
  }

  /**
   * Get a new factory instance for the model.
   *
   * The factory is resolved by convention - registerFactory(UserFactory)
   * pairs User with UserFactory - or by the newFactory() override below
   * when a model needs something other than the conventional class.
   * Laravel: HasFactory::factory()
   */
  static factory<T extends Ensemble>(
    this: EnsembleClass<T>,
    countOrState?: number | FactoryState,
    state?: FactoryState
  ): Factory<T> {
    return resolveModelFactory(this, countOrState, state);
  }

  /**
   * Create a new factory instance for the model. Overriding this static
   * hook - and returning a factory - bypasses the User -> UserFactory
   * convention entirely. The default returns null, which lets the
   * resolution fall through to the registered conventions.
   * Laravel: HasFactory::newFactory()
   */
  protected static newFactory(): Factory<any> | null {
    return null;
  }

  /**
   * Register an observer class or instance for this model.
   *
   * Any of the lifecycle hooks (`creating`, `created`, `updating`, `updated`,
   * `saving`, `saved`, `deleting`, `deleted`, `retrieved`, `softDeleting`,
   * `softDeleted`, `restoring`, `restored`, `forceDeleting`, `forceDeleted`)
   * is called when present on the observer. Halting events abort the
   * operation when the hook returns `false`.
   */
  static observe(observer: ObserverRegistration): void {
    ObserverRegistry.observe(this, observer);
  }

  /**
   * Forget the observers registered directly on this model class
   */
  static forgetObservers(): void {
    ObserverRegistry.clear(this);
  }

  /**
   * Add a global scope to this model class.
   *
   * Accepts either a `Scope` instance / callback, or an explicit identifier
   * plus scope: `addGlobalScope(scope)` / `addGlobalScope('published', fn)`.
   */
  static addGlobalScope(scope: AnyGlobalScope): void;
  static addGlobalScope(name: string, scope: AnyGlobalScope): void;
  static addGlobalScope(scopeOrName: AnyGlobalScope | string, scope?: AnyGlobalScope): void {
    if (typeof scopeOrName === 'string') {
      if (!scope) {
        throw new Error('addGlobalScope(name, scope) requires a scope.');
      }

      GlobalScopeRegistry.add(this, scopeOrName, scope);
      return;
    }

    GlobalScopeRegistry.add(this, GlobalScopeRegistry.identifierFor(scopeOrName), scopeOrName);
  }

  /**
   * Register a global scope under an explicit identifier
   */
  static withGlobalScope(name: string, scope: AnyGlobalScope): void {
    GlobalScopeRegistry.add(this, name, scope);
  }

  /**
   * Every global scope applying to this model class, including inherited ones
   */
  static getGlobalScopes(): Map<string, AnyGlobalScope> {
    return GlobalScopeRegistry.forModel(this);
  }

  /**
   * Remove global scopes registered directly on this class: one by identifier,
   * or all when no name is given
   */
  static forgetGlobalScopes(name?: string): void {
    if (name) {
      GlobalScopeRegistry.remove(this, name);
    } else {
      GlobalScopeRegistry.clear(this);
    }
  }

  /**
   * Begin querying with a global scope excluded from the query
   */
  static withoutGlobalScope<T extends Ensemble>(this: { new (): T }, name: string | Function): EnsembleBuilder<T> {
    return (this as any).query().withoutGlobalScope(name);
  }

  /**
   * Begin querying with several global scopes excluded, or all of them when
   * none are named
   */
  static withoutGlobalScopes<T extends Ensemble>(
    this: { new (): T },
    names?: (string | Function)[]
  ): EnsembleBuilder<T> {
    return (this as any).query().withoutGlobalScopes(names);
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
    // Fire saving event
    if ((await this.fireModelEvent('saving')) === false) {
      return false;
    }

    if (this.exists) {
      return this.performUpdate();
    }

    return this.performInsert();
  }

  /**
   * Perform a model insert operation
   */
  protected async performInsert(): Promise<boolean> {
    // Fire creating event
    if ((await this.fireModelEvent('creating')) === false) {
      return false;
    }

    const attributes = this.getAttributesForInsert();

    if (this.timestamps) {
      this.updateTimestamps();
    }

    const connection = this.getConnection();
    const table = this.getTable();

    // The model's key is passed along so the dialect reads the generated value
    // back from the column this model actually uses, never an assumed `id`.
    const id = await connection.table(table).insertGetId(attributes, this.getKeyName());

    if (this.incrementing) {
      this.setAttribute(this.getKeyName(), id);
    }

    this.exists = true;
    this.wasRecentlyCreated = true;
    this.syncOriginal();

    // Fire created event
    await this.fireModelEvent('created');

    // Fire saved event
    await this.fireModelEvent('saved');

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

    // Fire updating event
    if ((await this.fireModelEvent('updating')) === false) {
      return false;
    }

    if (this.timestamps) {
      this.updateTimestamps();
    }

    const connection = this.getConnection();
    const table = this.getTable();

    await connection.table(table).where(this.getKeyName(), '=', this.getKey()).update(dirty);

    this.syncOriginal();

    // Fire updated event
    await this.fireModelEvent('updated');

    // Fire saved event
    await this.fireModelEvent('saved');

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
    const cast = this.castType(key);
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
   *
   * Soft-deleting models stamp the `deleted_at` column and leave the row in
   * the table; every other model issues a hard `DELETE`.
   */
  async delete(): Promise<boolean> {
    if (!this.exists) {
      return false;
    }

    // Fire deleting event
    if ((await this.fireModelEvent('deleting')) === false) {
      return false;
    }

    const deleted =
      this.usesSoftDeletes() && !this.forceDeleting ? await this.runSoftDelete() : await this.runHardDelete();

    if (!deleted) {
      return false;
    }

    // Fire deleted event
    await this.fireModelEvent('deleted');

    return true;
  }

  /**
   * Issue the hard `DELETE` for the model and forget its identity
   */
  protected async runHardDelete(): Promise<boolean> {
    const connection = this.getConnection();
    const table = this.getTable();

    await connection.table(table).where(this.getKeyName(), '=', this.getKey()).delete();

    this.exists = false;

    return true;
  }

  /**
   * Stamp the deleted-at column instead of removing the row
   *
   * The update goes straight to the connection the way Laravel's
   * `runSoftDelete()` does: writing `deleted_at` is not a model save, so no
   * `saving`/`updating` events fire around it.
   */
  protected async runSoftDelete(): Promise<boolean> {
    // Fire soft deleting event
    await this.fireModelEvent('softDeleting');

    const deletedAt = new Date();
    const columns: Record<string, any> = { [this.getDeletedAtColumn()]: deletedAt };
    this.setAttribute(this.getDeletedAtColumn(), deletedAt);

    const updatedAtColumn = this.getUpdatedAtColumn();
    if (updatedAtColumn) {
      columns[updatedAtColumn] = deletedAt;
      this.setAttribute(updatedAtColumn, deletedAt);
    }

    const connection = this.getConnection();
    const table = this.getTable();

    await connection.table(table).where(this.getKeyName(), '=', this.getKey()).update(columns);

    this.syncOriginal();

    // Fire soft deleted event
    await this.fireModelEvent('softDeleted');

    return true;
  }

  /**
   * Force a hard delete on a soft deleted model
   *
   * Runs the full delete lifecycle (`deleting`/`deleted`) with the
   * soft-delete shortcut disabled, wrapped in the `forceDeleting`/
   * `forceDeleted` events.
   */
  async forceDelete(): Promise<boolean> {
    if (!this.exists) {
      return false;
    }

    // Fire force deleting event
    if ((await this.fireModelEvent('forceDeleting')) === false) {
      return false;
    }

    this.forceDeleting = true;
    const deleted = await this.delete();
    this.forceDeleting = false;

    if (deleted) {
      // Fire force deleted event
      await this.fireModelEvent('forceDeleted');
    }

    return deleted;
  }

  /**
   * Restore a soft-deleted model instance
   */
  async restore(): Promise<boolean> {
    // Fire restoring event
    if ((await this.fireModelEvent('restoring')) === false) {
      return false;
    }

    this.setAttribute(this.getDeletedAtColumn(), null);
    this.exists = true;

    const restored = await this.save();

    // Fire restored event
    await this.fireModelEvent('restored');

    return restored;
  }

  /**
   * Determine if the model instance has been soft-deleted
   */
  trashed(): boolean {
    const deletedAt = this.getAttribute(this.getDeletedAtColumn());

    return deletedAt !== null && deletedAt !== undefined;
  }

  /**
   * Determine whether this model soft deletes instead of removing rows
   */
  usesSoftDeletes(): boolean {
    return (this.constructor as typeof Ensemble).softDeletes === true;
  }

  /**
   * Get the name of the "deleted at" column
   */
  getDeletedAtColumn(): string {
    return (this.constructor as typeof Ensemble).DELETED_AT;
  }

  /**
   * Get the fully qualified "deleted at" column
   */
  getQualifiedDeletedAtColumn(): string {
    return `${this.getTable()}.${this.getDeletedAtColumn()}`;
  }

  /**
   * Reload the current model instance from the database
   */
  async refresh(): Promise<this> {
    if (!this.exists) {
      return this;
    }

    const query: EnsembleBuilder<any> = (this.constructor as any).query();

    // A trashed model still exists, so its row has to be read back with the
    // soft-delete exclusion lifted.
    if (this.usesSoftDeletes()) {
      query.withTrashed();
    }

    const fresh = await query.find(this.getKey());

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

  /**
   * Fire the given model event
   *
   * Observers registered through `observe()` / `@ObservedBy` run first, then
   * the global event dispatcher. Both can halt a halting event (`saving`,
   * `creating`, `updating`, `deleting`, `restoring`, `forceDeleting`) by
   * returning `false`.
   *
   * @param event - Event name (saving, saved, creating, created, etc.)
   * @returns false if event is halting and a listener returned false, undefined otherwise
   */
  protected async fireModelEvent(event: string): Promise<boolean | undefined> {
    // Observer hooks fire through the same lifecycle path as the dispatcher.
    if ((await ObserverRegistry.notify(this, event)) === false) {
      return false;
    }

    // Try to get the event dispatcher
    let dispatcher: any;
    try {
      // Import the Dispatcher and get from static resolver if available
      const { Dispatcher } = await import('@/Events/Dispatcher');
      const { Facade } = await import('@/Support/Facade');

      try {
        dispatcher = Facade.getFacadeApplication()?.make?.('events');
      } catch {
        // No dispatcher registered
      }
    } catch (error) {
      // Event system not set up, skip firing events
      return undefined;
    }

    if (!dispatcher || typeof dispatcher.dispatch !== 'function') {
      return undefined;
    }

    // Map event names to event classes
    const eventMap: Record<string, any> = {
      retrieved: ModelRetrieved,
      creating: ModelCreating,
      created: ModelCreated,
      updating: ModelUpdating,
      updated: ModelUpdated,
      saving: ModelSaving,
      saved: ModelSaved,
      deleting: ModelDeleting,
      deleted: ModelDeleted,
      softDeleting: ModelSoftDeleting,
      softDeleted: ModelSoftDeleted,
      restoring: ModelRestoring,
      restored: ModelRestored,
      forceDeleting: ModelForceDeleting,
      forceDeleted: ModelForceDeleted,
    };

    const EventClass = eventMap[event];
    if (!EventClass) {
      return undefined;
    }

    const eventInstance = new EventClass(this);

    // For halting events (creating, updating, saving, deleting, restoring,
    // forceDeleting), use until() which returns the first non-null result
    // (false halts the operation)
    if (HALTING_MODEL_EVENTS.includes(event)) {
      const result = await dispatcher.until?.(eventInstance);
      // If any listener returns false, halt the operation
      if (result === false) {
        return false;
      }
    } else {
      // For non-halting events, just dispatch normally
      await dispatcher.dispatch(eventInstance);
    }

    return undefined;
  }
}
