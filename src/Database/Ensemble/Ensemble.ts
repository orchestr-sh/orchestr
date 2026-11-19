/**
 * Ensemble Class
 *
 * Base class for Ensemble models with ActiveRecord pattern
 * In Orchestr, your data models are called Ensembles - groups that work in harmony
 */

import type { CastsAttributes } from '@/Database/Contracts/CastsAttributes';
import type { EnsembleClass, Factory, FactoryState } from '@/Database/Factories/Factory';
import type { Encrypter as CrypterContract } from '@/Encryption/Contracts/Encrypter';
import type { Hasher as HasherContract } from '@/Hashing/Contracts/Hasher';
import { Connection } from '@/Database/Connection';
import { DatabaseManager } from '@/Database/DatabaseManager';
import { resolveModelFactory } from '@/Database/Factories/HasFactory';
import { getGlobalApp } from '@/Support/helpers';
import type { CastDefinition } from './Casts';
import type { SoftDeletes } from './SoftDeletes';
import { Attribute, CastRegistry, DateCast, valuesEqual } from './Casts';
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
   * The hasher resolver used by `hashed` casts, when one was installed
   * explicitly through Ensemble.hashUsing()
   */
  protected static hashResolver: (() => HasherContract) | null = null;

  /**
   * Per-class cache of which camelCase methods are modern `Attribute`
   * accessors, so the probe runs once per model class rather than per read.
   */
  private static accessorCache = new Map<Function, Map<string, Attribute | null>>();

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
  static casts?: Record<string, CastDefinition>;

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
   * The attributes that should be cast. Values may be a cast string
   * (`'int'`, `'decimal:2'`, `'enum:Status'`, a registered custom name), a
   * `CastsAttributes` class or instance, a `{ class, arguments }` object, or
   * a TypeScript enum object. Everything resolves through the
   * `CastRegistry`, so reads and writes never disagree.
   */
  protected casts: Record<string, CastDefinition> = {};

  /**
   * Casts merged at runtime through `mergeCasts()`, kept apart from the
   * declared maps so the static-over-instance precedence survives.
   */
  protected runtimeCasts: Record<string, CastDefinition> = {};

  /**
   * Indicates if the model should be timestamped
   */
  protected timestamps: boolean = true;

  /**
   * Timestamps are skipped for this model alone while `withoutTimestamps()`
   * runs, which is how a one-off write keeps the row's own clock untouched.
   */
  protected timestampsSuppressed: boolean = false;

  /**
   * Lifecycle events are skipped for this model alone while
   * `withoutEvents()` runs.
   */
  protected eventsSuppressed: boolean = false;

  /**
   * Mass assignment protection is off for this model while `unguard()` has it
   * off, so a guarded column can be written without editing the class.
   */
  protected unguarded: boolean = false;

  /**
   * Reading a relation that was never loaded throws instead of querying.
   */
  protected preventsLazyLoading: boolean = false;

  /**
   * Strict mode: `fill()` reports the attributes it would silently drop.
   */
  protected strict: boolean = false;

  /**
   * The attributes the last write put into the table, which is what
   * `getChanges()` and `wasChanged()` report. The edits waiting to be written
   * are `getDirty()`.
   */
  protected changes: Record<string, any> = {};

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
   *
   * Strict mode reports what it refuses instead of dropping it, which is the
   * difference between a typo in a column name and a silent no-op.
   */
  fill(attributes: Record<string, any>): this {
    for (const [key, value] of Object.entries(attributes)) {
      if (this.isFillable(key)) {
        this.setAttribute(key, value);
      } else if (this.strict) {
        throw new Error(`This [${this.constructor.name}] does not allow [${key}] to be mass assigned.`);
      }
    }
    return this;
  }

  /**
   * Set a given attribute on the model
   *
   * Resolution order, mirroring Laravel's `setAttribute()`: a legacy
   * `setXAttribute` mutator first, then a modern `Attribute` mutator, then
   * the cast's `set` - which is where encrypted, hashed, JSON, date and
   * custom casts turn the application value into the stored form. Whatever
   * comes back is what the attributes (and therefore the persistence
   * bindings) hold.
   */
  setAttribute(key: string, value: any): this {
    // Legacy set mutator
    const mutator = `set${this.studly(key)}Attribute`;
    if (typeof (this as any)[mutator] === 'function') {
      (this as any)[mutator](value);
      return this;
    }

    // Modern Attribute mutator: whatever it returns is stored.
    const accessor = this.findAttributeAccessor(key);
    if (accessor && accessor.set) {
      const stored = accessor.set(value, this.attributes);
      this.attributes[key] = stored === undefined ? value : stored;
      return this;
    }

    // Cast classes own their write path, so encrypted values are encrypted,
    // dates normalised, and so on, all through the one registered cast.
    const cast = this.resolveCast(key);
    if (cast) {
      this.attributes[key] = cast.set(this, key, value, this.attributes);
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
   *
   * The precedence mirrors Laravel's `getAttribute()`: a legacy
   * `getXAttribute` accessor first, then a modern `Attribute` accessor, then
   * the cast's read transform, and finally the raw stored value.
   */
  getAttribute(key: string): any {
    if (!key) {
      return undefined;
    }

    // Legacy accessor
    const accessor = `get${this.studly(key)}Attribute`;
    if (typeof (this as any)[accessor] === 'function') {
      return (this as any)[accessor]();
    }

    // Modern Attribute accessor
    const attribute = this.findAttributeAccessor(key);
    if (attribute && attribute.get) {
      return attribute.get(this.attributes[key], this.attributes);
    }

    // Cast the attribute if needed
    if (this.hasCast(key)) {
      return this.castAttribute(key, this.attributes[key]);
    }

    return this.attributes[key];
  }

  /**
   * Determine if the given attribute may be mass assigned.
   *
   * `unguard()` answers first: while the model is unguarded every key is
   * fillable and the lists below are not consulted at all.
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
    if (this.unguarded) {
      return true;
    }

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
   * The `Attribute` object declared for an attribute, either form of it:
   *
   *   - a property holding one (`slug = Attribute.make(...)`)
   *   - a camelCase method returning one (`firstName(): Attribute`, the
   *     return type Laravel reads through reflection)
   *
   * A method that merely shares the attribute's name is probed once per
   * class and cached; probing anything else that fails, returns something
   * other than an Attribute, or throws simply means "not an accessor".
   * Laravel: HasAttributes::hasAttributeMutator()
   */
  protected findAttributeAccessor(key: string): Attribute | undefined {
    const camel = this.camelCase(key);

    const direct = (this as any)[camel] ?? (this as any)[key];

    if (direct instanceof Attribute) {
      return direct;
    }

    if (typeof direct !== 'function') {
      return undefined;
    }

    let cache = Ensemble.accessorCache.get(this.constructor);
    if (!cache) {
      cache = new Map();
      Ensemble.accessorCache.set(this.constructor, cache);
    }

    if (cache.has(camel)) {
      const cached = cache.get(camel);
      return cached ?? undefined;
    }

    let found: Attribute | null = null;
    try {
      const result = direct.call(this);
      if (result instanceof Attribute) {
        found = result;
      }
    } catch {
      // The method is not an accessor; anything it raised is not our concern.
      found = null;
    }

    cache.set(camel, found);

    return found ?? undefined;
  }

  /**
   * Whether a get accessor - legacy or modern - claims this attribute, in
   * which case its result is the serialized value as-is.
   */
  protected hasGetAccessor(key: string): boolean {
    if (this.hasGetMutator(key)) {
      return true;
    }

    const accessor = this.findAttributeAccessor(key);

    return accessor !== undefined && accessor.get !== undefined;
  }

  /**
   * camelCase form of an attribute name, the method Laravel's `Str::camel`
   * expects modern accessors to be declared under.
   */
  protected camelCase(key: string): string {
    const studly = this.studly(key);

    return studly.charAt(0).toLowerCase() + studly.slice(1);
  }

  /**
   * Determine if a cast is defined for an attribute.
   *
   * `types` narrows the question to specific base cast names, the way
   * Laravel's `hasCast($key, ['date', 'datetime'])` does.
   * Laravel: HasAttributes::hasCast()
   */
  public hasCast(key: string, types?: string | string[]): boolean {
    const entry = this.castType(key);

    if (entry === undefined) {
      return false;
    }

    if (!types) {
      return true;
    }

    const requested = Array.isArray(types) ? types : [types];
    const base = this.getCastType(key);

    return base !== undefined && requested.includes(base);
  }

  /**
   * The complete casts map for this model: the declared instance and static
   * maps, anything merged at runtime, and the soft-delete column's implicit
   * date cast. One map drives reads, dirty comparison and persistence, so
   * they cannot disagree.
   * Laravel: HasAttributes::getCasts()
   */
  public getCasts(): Record<string, CastDefinition> {
    const ctor = this.constructor as typeof Ensemble;

    const staticCasts: Record<string, CastDefinition> | undefined = Object.prototype.hasOwnProperty.call(ctor, 'casts')
      ? ctor.casts
      : undefined;

    const casts: Record<string, CastDefinition> = { ...this.casts, ...staticCasts, ...this.runtimeCasts };

    if (this.usesSoftDeletes() && !(this.getDeletedAtColumn() in casts)) {
      casts[this.getDeletedAtColumn()] = 'datetime';
    }

    return casts;
  }

  /**
   * Merge additional casts into the model for the life of this instance.
   * Entries are normalized to string values first, exactly like Laravel's
   * `mergeCasts()`.
   * Laravel: HasAttributes::mergeCasts()
   */
  public mergeCasts(casts: Record<string, CastDefinition>): this {
    this.runtimeCasts = { ...this.runtimeCasts, ...this.ensureCastsAreStringValues(casts) };
    return this;
  }

  /**
   * Reduce a casts map to string values. Registered classes, instances,
   * `{ class, arguments }` objects and registered enums all have a canonical
   * string form; entries with no registered name report themselves rather
   * than pretending to be strings they cannot be.
   * Laravel: HasAttributes::ensureCastsAreStringValues()
   */
  public ensureCastsAreStringValues(casts?: Record<string, CastDefinition>): Record<string, string> {
    const source = casts ?? this.getCasts();
    const strings: Record<string, string> = {};

    for (const [key, entry] of Object.entries(source)) {
      strings[key] = CastRegistry.nameFor(entry);
    }

    return strings;
  }

  /**
   * The base cast name of an attribute - `'date'` for `'date:Y-m-d'`, the
   * registered (or class) name for a cast object - used by `hasCast` when
   * the caller asks about specific types.
   * Laravel: HasAttributes::getCastType()
   */
  protected getCastType(key: string): string | undefined {
    const entry = this.castType(key);

    if (entry === undefined) {
      return undefined;
    }

    if (typeof entry === 'string') {
      const separator = entry.indexOf(':');
      return separator === -1 ? entry : entry.slice(0, separator);
    }

    if (typeof entry === 'function') {
      try {
        return CastRegistry.nameFor(entry);
      } catch {
        return entry.name;
      }
    }

    const candidate = entry as Partial<{ class: unknown; get: unknown }>;

    if (candidate.get === undefined && candidate.class === undefined) {
      return 'enum';
    }

    try {
      return CastRegistry.nameFor(entry);
    } catch {
      return undefined;
    }
  }

  /**
   * The cast entry applied to an attribute, if any, resolved through the
   * one registry every code path shares.
   */
  protected resolveCast(key: string): CastsAttributes | undefined {
    return CastRegistry.resolve(this.castType(key));
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
   * `mergeCasts()` entries beat both, because they were asked for later.
   */
  protected castType(key: string): CastDefinition | undefined {
    return this.getCasts()[key];
  }

  /**
   * Cast an attribute to its application shape by running the registered
   * cast's `get`.
   *
   * Absent and null values pass through untouched: casting `undefined` would
   * invent data (an Invalid `Date`, say) where the model simply has nothing.
   */
  protected castAttribute(key: string, value: any): any {
    if (value === null || value === undefined) {
      return value;
    }

    const cast = this.resolveCast(key);

    if (!cast) {
      return value;
    }

    return cast.get(this, key, value, this.attributes);
  }

  /**
   * Convert the model to a plain object
   *
   * Every visible attribute travels through the same read path
   * (`getAttribute`) and then, when a cast defines a `serialize` step, that
   * too - so a `Collection` becomes an array, an `ArrayObject` an object, a
   * `Stringable` a string, and a formatted date its format - matching
   * Laravel's `attributesToArray()`.
   */
  toObject(): Record<string, any> {
    const attributes: Record<string, any> = {};

    for (const key of Object.keys(this.attributes)) {
      if (this.isVisible(key)) {
        attributes[key] = this.getAttributeForOutput(key);
      }
    }

    // Add appended accessors
    for (const key of this.appends) {
      attributes[key] = this.getAttributeForOutput(key);
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
   * The value an attribute takes in the model's array/JSON form: the cast's
   * serialized shape, or the accessor's result when one owns the attribute.
   * Laravel: HasAttributes::getAttributeFromArray() + mutateAttributeForArray
   */
  protected getAttributeForOutput(key: string): any {
    const value = this.getAttribute(key);

    // An accessor already owns the output; casts do not run a second pass.
    if (this.hasGetAccessor(key)) {
      return value;
    }

    if (!this.hasCast(key)) {
      return value;
    }

    const cast = this.resolveCast(key);

    if (cast && typeof cast.serialize === 'function') {
      return cast.serialize(this, key, value, this.attributes);
    }

    return value;
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
   * Provide the hasher used by `hashed` casts
   *
   * The HashServiceProvider wires this through the container; apps building
   * a hasher by hand - or tests that want a deterministic one - can install
   * it directly. Passing null clears the resolver again.
   *
   * Laravel: Hash facade resolution for the hashed cast
   */
  static hashUsing(hasher: HasherContract | (() => HasherContract) | null): void {
    if (hasher === null) {
      (Ensemble as any).hashResolver = null;
      return;
    }

    const factory = typeof hasher === 'function' ? (hasher as () => HasherContract) : () => hasher;
    (Ensemble as any).hashResolver = factory;
  }

  /**
   * The hasher hashed casts run through: the resolver installed with
   * hashUsing(), else the container's 'hash' binding
   */
  protected hasher(): HasherContract {
    if (Ensemble.hashResolver) {
      return Ensemble.hashResolver();
    }

    const app = getGlobalApp();

    if (app && app.bound('hash')) {
      return app.make<HasherContract>('hash');
    }

    throw new Error(
      'A hasher is required for hashed casts. Register the HashServiceProvider or call Ensemble.hashUsing().'
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
   * Laravel: Eloquent\Model::updateOrCreate()
   */
  static async updateOrCreate<T extends Ensemble>(
    this: { new (): T },
    attributes: Record<string, any>,
    values: Record<string, any> = {}
  ): Promise<T> {
    return (this as any).findOrCreate(attributes, values, { updateExisting: true });
  }

  /**
   * Find the first model matching the attributes or create it
   * Laravel: Eloquent\Model::firstOrCreate()
   */
  static async firstOrCreate<T extends Ensemble>(
    this: { new (): T },
    attributes: Record<string, any>,
    values: Record<string, any> = {}
  ): Promise<T> {
    return (this as any).findOrCreate(attributes, values);
  }

  /**
   * Create the model, or return the row that beat it to the unique index
   *
   * The insert runs first, so the index is what decides whether this process
   * wrote the row. Only a unique-constraint conflict is turned into a re-read:
   * every other failure keeps travelling up the stack untouched.
   * Laravel: Eloquent\Model::createOrFirst()
   */
  static async createOrFirst<T extends Ensemble>(
    this: { new (): T },
    attributes: Record<string, any>,
    values: Record<string, any> = {}
  ): Promise<T> {
    return (this as any).findOrCreate(attributes, values, { createFirst: true });
  }

  /**
   * Find the first model matching the attributes or return an unsaved instance
   * Laravel: Eloquent\Model::firstOrNew()
   */
  static async firstOrNew<T extends Ensemble>(
    this: { new (attributes?: Record<string, any>): T },
    attributes: Record<string, any>,
    values: Record<string, any> = {}
  ): Promise<T> {
    const existing = await (this as any).matching(attributes).first();

    return existing ?? new this({ ...attributes, ...values });
  }

  /**
   * Find a model by its primary key or return an instance carrying that key
   * Laravel: Eloquent\Model::findOrNew()
   */
  static async findOrNew<T extends Ensemble>(
    this: { new (attributes?: Record<string, any>): T },
    id: any,
    columns: string[] = ['*']
  ): Promise<T> {
    const existing = await (this as any).find(id, columns);

    if (existing) {
      return existing;
    }

    const instance: T = new this();
    instance.setAttribute(instance.getKeyName(), id);

    return instance;
  }

  /**
   * The single find-or-write path `firstOrCreate`, `createOrFirst`, and
   * `updateOrCreate` run through: look for the row the matching attributes
   * describe, and when there is none write one from the merge of those
   * attributes and the values.
   *
   * `createFirst` reverses the order for `createOrFirst`, which lets the
   * unique index decide and only reads when the insert is rejected.
   * `updateExisting` saves the values onto the row that was found rather than
   * leaving it as it is, which is all that separates `updateOrCreate` from
   * `firstOrCreate`.
   */
  protected static async findOrCreate<T extends Ensemble>(
    this: { new (): T },
    attributes: Record<string, any>,
    values: Record<string, any>,
    options: { createFirst?: boolean; updateExisting?: boolean } = {}
  ): Promise<T> {
    const merged = { ...attributes, ...values };

    if (options.createFirst) {
      try {
        return await (this as any).create(merged);
      } catch (error) {
        if (!(this as any).isUniqueViolation(error)) {
          throw error;
        }

        const raced = await (this as any).matching(attributes).first();

        if (!raced) {
          throw error;
        }

        return raced;
      }
    }

    const existing = await (this as any).matching(attributes).first();

    if (existing) {
      if (options.updateExisting) {
        existing.fill(values);
        await existing.save();
      }

      return existing;
    }

    return (this as any).create(merged);
  }

  /**
   * The query that matches an attribute map, each pair applied as an equality
   * constraint - which is how Eloquent reads `where(['email' => ...])`.
   */
  protected static matching<T extends Ensemble>(
    this: { new (): T },
    attributes: Record<string, any>
  ): EnsembleBuilder<T> {
    const query = (this as any).query() as EnsembleBuilder<T>;

    for (const [column, value] of Object.entries(attributes)) {
      query.where(column, '=', value);
    }

    return query;
  }

  /**
   * Whether a failed write was rejected by a unique index, the one conflict
   * `createOrFirst` can resolve by reading the row somebody else committed.
   */
  protected static isUniqueViolation(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);

    return /unique|duplicate/i.test(message);
  }

  /**
   * Get the single record matching the given columns, or fail loudly
   * Laravel: Eloquent\Model::sole()
   */
  static async sole<T extends Ensemble>(this: { new (): T }, columns: string[] = ['*']): Promise<T> {
    return (this as any).query().sole(columns);
  }

  /**
   * Get the first record matching a column, or none
   * Laravel: Eloquent\Model::firstWhere()
   */
  static async firstWhere<T extends Ensemble>(
    this: { new (): T },
    column: string,
    operator?: any,
    value?: any,
    columns: string[] = ['*']
  ): Promise<T | null> {
    return (this as any).query().firstWhere(column, operator, value, columns);
  }

  /**
   * Get a single column's value from the first matching record
   * Laravel: Eloquent\Model::value()
   */
  static async value<T extends Ensemble>(this: { new (): T }, column: string): Promise<any> {
    return (this as any).query().value(column);
  }

  /**
   * Get a column's values from every matching record
   * Laravel: Eloquent\Model::pluck()
   */
  static async pluck<T extends Ensemble>(this: { new (): T }, column: string): Promise<any[]> {
    return (this as any).query().pluck(column);
  }

  /**
   * Delete the models with the given keys, firing each one's lifecycle
   *
   * Every key is loaded and deleted through its own model, so a soft-deleting
   * class stamps its rows and the observers see the deletes a bulk statement
   * would skip. Returns the number of models deleted.
   * Laravel: Eloquent\Model::destroy()
   */
  static async destroy<T extends Ensemble>(this: { new (): T }, ...ids: any[]): Promise<number> {
    return (this as any).query().destroy(ids.flat(Infinity) as any[]);
  }

  /**
   * Empty the model's table
   * Laravel: Eloquent\Model::truncate()
   */
  static async truncate<T extends Ensemble>(this: { new (): T }): Promise<void> {
    await (this as any).query().truncate();
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
   * Save the model inside a transaction
   *
   * A write that halts mid-way leaves the database exactly as it was, so a
   * failure never strands part of a multi-row operation. A cancelled lifecycle
   * event is the same kind of refusal, and it surfaces as an exception instead
   * of a quiet `false`. Laravel: Model::saveOrFail()
   */
  async saveOrFail(): Promise<boolean> {
    return this.getConnection().transaction(async () => {
      const saved = await this.save();

      if (saved === false) {
        throw new Error(`The save of [${this.constructor.name}] was cancelled by a model event.`);
      }

      return true;
    });
  }

  /**
   * Save the model and every relation loaded onto it
   *
   * The parent writes first so the children have a key to hang on to, and each
   * relation pushes its own loaded relations the same way.
   * Laravel: Model::push()
   */
  async push(): Promise<boolean> {
    if (!(await this.save())) {
      return false;
    }

    return this.pushLoadedRelations(new Set([this]));
  }

  /**
   * Write every relation already loaded on this model
   *
   * Models already on the way down are skipped, so a parent and a child that
   * reference each other are written once rather than forever.
   */
  protected async pushLoadedRelations(visited: Set<Ensemble>): Promise<boolean> {
    for (const value of Object.values(this.relations)) {
      for (const related of Ensemble.walkModels(value)) {
        if (visited.has(related)) {
          continue;
        }

        visited.add(related);

        if (!(await related.save())) {
          return false;
        }

        if (!(await related.pushLoadedRelations(visited))) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * The models inside a relation value: one model, a list of them, or a
   * collection holding them.
   */
  protected static walkModels(value: any): Ensemble[] {
    if (value instanceof Ensemble) {
      return [value];
    }

    if (Array.isArray(value)) {
      return value.filter((model) => model instanceof Ensemble);
    }

    if (value && typeof value.all === 'function') {
      return value.all().filter((model: any) => model instanceof Ensemble);
    }

    return [];
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

    if (this.updatesTimestamps()) {
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
    this.changes = { ...attributes };
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

    if (this.updatesTimestamps()) {
      this.updateTimestamps();
    }

    const connection = this.getConnection();
    const table = this.getTable();

    await connection.table(table).where(this.getKeyName(), '=', this.getKey()).update(dirty);

    this.changes = dirty;
    this.syncOriginal();

    // Fire updated event
    await this.fireModelEvent('updated');

    // Fire saved event
    await this.fireModelEvent('saved');

    return true;
  }

  /**
   * Whether the model's timestamps are being written right now
   *
   * Both the class setting and the per-model `withoutTimestamps()` window have
   * to allow it: a timestamp is a promise about the row, and either party can
   * take it back.
   */
  protected updatesTimestamps(): boolean {
    return this.timestamps && !this.timestampsSuppressed;
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
   *
   * When a cast exists, the two stored forms are decoded through it and the
   * *cast* values are compared, so re-serialising the same content (a JSON
   * column rewritten key-for-key, an encrypted field re-encrypted with a new
   * IV, a Collection set back to what it held) is recognised as no change at
   * all. Undecodable values fall back to comparing the stored forms.
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

    const cast = this.resolveCast(key);

    if (cast) {
      try {
        return valuesEqual(
          cast.get(this, key, current, this.attributes),
          cast.get(this, key, original, this.attributes)
        );
      } catch {
        // A value that will not decode is compared in its stored form.
        return String(current) === String(original);
      }
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
    const cast = this.resolveCast(key);

    if (cast instanceof DateCast) {
      return true;
    }

    const entry = this.castType(key);

    if (typeof entry !== 'string') {
      return false;
    }

    const base = entry.indexOf(':') === -1 ? entry : entry.slice(0, entry.indexOf(':'));

    return ['date', 'datetime', 'immutable_date', 'immutable_datetime', 'timestamp'].includes(base);
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
   * Sync one attribute back to its stored value
   *
   * The columns an increment or a touch wrote are already what the table
   * holds, while anything else the caller still has pending stays dirty.
   * Laravel: Model::syncOriginalAttribute()
   */
  protected syncOriginalAttribute(attribute: string): this {
    this.original[attribute] = this.attributes[attribute];
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
   * Read the model's row back as a separate instance
   *
   * `refresh()` rewrites this model in place; `fresh()` hands over what the
   * table holds now and leaves the caller's copy untouched, which is how a
   * concurrent write becomes visible without losing the edits in hand.
   * Laravel: Model::fresh()
   */
  async fresh(columns: string[] = ['*']): Promise<this | null> {
    if (!this.exists) {
      return null;
    }

    const query: EnsembleBuilder<any> = (this.constructor as any).query();

    // A trashed row is still this model's row, so the exclusion comes off.
    if (this.usesSoftDeletes() && this.trashed()) {
      query.withTrashed();
    }

    return (await query.select(...columns).find(this.getKey())) as this | null;
  }

  /**
   * Add to a numeric column and write just that
   *
   * The statement lets the database do the arithmetic (`votes = votes + ?`),
   * so two processes incrementing the same row add up instead of the later
   * write overwriting the earlier one. The model mirrors the value it asked
   * for, and only the columns that went to the table are synced back to their
   * originals: anything else still held pending stays pending.
   * Laravel: Model::incrementOrDecrement()
   */
  async increment(column: string, amount: number = 1, extra: Record<string, any> = {}): Promise<this> {
    return this.adjustColumn(column, amount, extra, true);
  }

  /**
   * Subtract from a numeric column and write just that
   */
  async decrement(column: string, amount: number = 1, extra: Record<string, any> = {}): Promise<this> {
    return this.adjustColumn(column, amount, extra, false);
  }

  /**
   * The shared increment/decrement path: one statement, the operator is all
   * that differs.
   */
  protected async adjustColumn(column: string, amount: number, extra: Record<string, any>, up: boolean): Promise<this> {
    const moved = Number(this.getAttribute(column) ?? 0) + (up ? amount : -amount);

    // No row to move yet: the value rides along on the first save.
    if (!this.exists) {
      this.setAttribute(column, moved);
      await this.save();

      return this;
    }

    if ((await this.fireModelEvent('updating')) === false) {
      return this;
    }

    const values: Record<string, any> = { ...extra };
    const updatedAt = this.getUpdatedAtColumn();

    if (updatedAt && this.updatesTimestamps()) {
      values[updatedAt] = new Date();
    }

    // The statement addresses this row and lets the database do the
    // arithmetic, so a concurrent writer adds to the same total rather than
    // being overwritten by this one.
    const statement = this.getConnection().table(this.getTable()).where(this.getKeyName(), '=', this.getKey());

    await (up ? statement.increment(column, amount, values) : statement.decrement(column, amount, values));

    // Memory and table now agree, and only the columns that went to the table
    // stop being dirty: an edit the caller never asked to write stays pending.
    this.setAttribute(column, moved);

    for (const [key, value] of Object.entries(values)) {
      this.setAttribute(key, value);
    }

    this.changes = { [column]: moved, ...values };

    for (const key of Object.keys(this.changes)) {
      this.syncOriginalAttribute(key);
    }

    await this.fireModelEvent('updated');

    return this;
  }

  /**
   * Stamp the model's timestamps, and only them
   *
   * The rest of the row waits for a real save: a touch moves the row's clock,
   * not its content. With timestamps suppressed there is nothing to stamp, so
   * neither the write nor the events around it happen at all.
   * Laravel: Model::touch()
   */
  async touch(columns?: string[]): Promise<boolean> {
    const updatedAt = this.getUpdatedAtColumn();

    if (!this.exists || !updatedAt || !this.updatesTimestamps()) {
      return false;
    }

    const names = columns && columns.length > 0 ? columns : [updatedAt];
    const time = new Date();
    const values: Record<string, any> = {};

    for (const name of names) {
      values[name] = time;
      this.setAttribute(name, time);
    }

    if ((await this.fireModelEvent('updating')) === false) {
      return false;
    }

    await this.getConnection().table(this.getTable()).where(this.getKeyName(), '=', this.getKey()).update(values);

    this.changes = values;

    for (const name of names) {
      this.syncOriginalAttribute(name);
    }

    await this.fireModelEvent('updated');

    return true;
  }

  /**
   * Copy the model into a new, unsaved instance
   *
   * The identity does not travel with the copy: the primary key is dropped, so
   * what comes back is a row waiting to be written rather than a second name
   * for the one it came from. `except` names the other columns to leave out -
   * typically the ones a unique index will not accept twice - and the
   * timestamps go too, because a new row starts its own clock.
   * Laravel: Model::replicate()
   */
  replicate(except: string[] = []): this {
    const attributes = { ...this.attributes };

    const dropped = [this.getKeyName(), this.getCreatedAtColumn(), this.getUpdatedAtColumn(), ...except].filter(
      (column): column is string => typeof column === 'string'
    );

    for (const column of dropped) {
      delete attributes[column];
    }

    const copy = this.newInstance();

    copy.setRawAttributes(attributes);
    copy.setRelations({ ...this.relations });
    copy.connection = this.connection;
    copy.exists = false;
    copy.wasRecentlyCreated = false;

    return copy as this;
  }

  /**
   * Determine whether this model *is* the given one
   *
   * Same class, same key: identity belongs to the row rather than to the
   * object holding it, so two separate reads of one record are the same model.
   * A row that was never written has no key to share, and two unsaved models
   * are therefore never each other.
   * Laravel: Model::is()
   */
  is(other: Ensemble): boolean {
    if (!(other instanceof Ensemble)) {
      return false;
    }

    const key = this.getKey();

    if (key === null || key === undefined) {
      return false;
    }

    return this.constructor === other.constructor && key === other.getKey();
  }

  /**
   * Determine whether this model is not the given one
   */
  isNot(other: Ensemble): boolean {
    return !this.is(other);
  }

  /**
   * Run a callback without writing this model's timestamps
   *
   * Laravel: Model::withoutTimestamps()
   */
  async withoutTimestamps<TResult>(callback: (model: this) => TResult | Promise<TResult>): Promise<TResult> {
    const previous = this.timestampsSuppressed;

    this.timestampsSuppressed = true;

    try {
      return await callback(this);
    } finally {
      this.timestampsSuppressed = previous;
    }
  }

  /**
   * Run a callback with this model's lifecycle events switched off
   *
   * Neither the observers nor the dispatcher hear about the writes the
   * callback makes, which is what a backfill needs: the row changes, nobody
   * is notified.
   * Laravel: Model::withoutEvents()
   */
  async withoutEvents<TResult>(callback: (model: this) => TResult | Promise<TResult>): Promise<TResult> {
    const previous = this.eventsSuppressed;

    this.eventsSuppressed = true;

    try {
      return await callback(this);
    } finally {
      this.eventsSuppressed = previous;
    }
  }

  /**
   * Run a callback with mass assignment protection off for this model
   *
   * The lists come back whether the callback returns or throws, so a failure
   * cannot leave the model permanently unguarded. `reguard()` is the same
   * switch for code that opens and closes it by hand.
   * Laravel: Model::unguard()
   */
  async unguard<TResult>(callback: (model: this) => TResult | Promise<TResult>): Promise<TResult> {
    const previous = this.unguarded;

    this.unguarded = true;

    try {
      return await callback(this);
    } finally {
      this.unguarded = previous;
    }
  }

  /**
   * Put the fillable and guarded lists back in charge
   * Laravel: Model::reguard()
   */
  reguard(): this {
    this.unguarded = false;
    return this;
  }

  /**
   * Make an unloaded relation an error rather than a query
   *
   * The eager load belongs where the query is written; `load()` and a dynamic
   * property read both go out to the database on their own, which is the
   * performance bug that shows up as a page issuing one select per row.
   * Laravel: Model::preventLazyLoading()
   */
  preventLazyLoading(value: boolean = true): this {
    this.preventsLazyLoading = value;
    return this;
  }

  /**
   * Turn on every check that reports a mistake instead of papering over it
   *
   * Right now that is lazy loading and silently discarded attributes; both
   * are the shape of "it worked, and the numbers were wrong".
   * Laravel: Model::shouldBeStrict()
   */
  shouldBeStrict(value: boolean = true): this {
    this.strict = value;

    return this.preventLazyLoading(value);
  }

  /**
   * The attributes the last write put into the table
   * Laravel: Model::getChanges()
   */
  getChanges(): Record<string, any> {
    return { ...this.changes };
  }

  /**
   * Determine whether an attribute was written by the last save
   * Laravel: Model::wasChanged()
   */
  wasChanged(attribute?: string | string[]): boolean {
    if (attribute === undefined) {
      return Object.keys(this.changes).length > 0;
    }

    return Ensemble.attributeList(attribute).some((key) => key in this.changes);
  }

  /**
   * Determine whether there is nothing left to write
   * Laravel: Model::isClean()
   */
  isClean(attribute?: string | string[]): boolean {
    if (attribute === undefined) {
      return !this.isDirty();
    }

    return Ensemble.attributeList(attribute).every((key) => !this.isDirty(key));
  }

  /**
   * The attributes as they were read, or one of them
   * Laravel: Model::getOriginal()
   */
  getOriginal(attribute?: string): any {
    return attribute === undefined ? { ...this.original } : this.original[attribute];
  }

  /**
   * Hide attributes from serialization
   *
   * Laravel: Model::makeHidden()
   */
  makeHidden(attributes: string | string[]): this {
    const names = Ensemble.attributeList(attributes);

    this.hidden = [...new Set([...this.hidden, ...names])];
    this.visible = this.visible.filter((key) => !names.includes(key));

    return this;
  }

  /**
   * Make hidden attributes serialize again
   *
   * A whitelist keeps its shape: when the model already lists the columns it
   * shows, what comes back is that list plus the newly visible one, rather
   * than the whole row.
   * Laravel: Model::makeVisible()
   */
  makeVisible(attributes: string | string[]): this {
    const names = Ensemble.attributeList(attributes);

    this.hidden = this.hidden.filter((key) => !names.includes(key));

    if (this.visible.length > 0) {
      this.visible = [...new Set([...this.visible, ...names])];
    }

    return this;
  }

  /**
   * Add accessors to the serialized form
   * Laravel: Model::append()
   */
  append(attributes: string | string[]): this {
    this.appends = [...new Set([...this.appends, ...Ensemble.attributeList(attributes)])];

    return this;
  }

  /**
   * Replace the accessors the serialized form carries
   * Laravel: Model::setAppends()
   */
  setAppends(attributes: string | string[]): this {
    this.appends = Ensemble.attributeList(attributes);

    return this;
  }

  /**
   * The accessors the serialized form carries
   */
  getAppends(): string[] {
    return [...this.appends];
  }

  /**
   * The serialized form, narrowed to the given attributes
   *
   * Everything the model shows applies first: casts, hidden columns, appended
   * accessors. `only` filters the shape the model already has.
   * Laravel: Model::only()
   */
  only(attributes: string | string[]): Record<string, any> {
    const serialized = this.toObject();
    const picked: Record<string, any> = {};

    for (const key of Ensemble.attributeList(attributes)) {
      if (key in serialized) {
        picked[key] = serialized[key];
      }
    }

    return picked;
  }

  /**
   * The serialized form, without the given attributes
   * Laravel: Model::except()
   */
  except(attributes: string | string[]): Record<string, any> {
    const serialized = this.toObject();

    for (const key of Ensemble.attributeList(attributes)) {
      delete serialized[key];
    }

    return serialized;
  }

  /**
   * One attribute name or a list of them, read the same way everywhere
   */
  protected static attributeList(attributes: string | string[]): string[] {
    return Array.isArray(attributes) ? attributes : [attributes];
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
   * Reading a relation that was never loaded is a violation, not a query
   *
   * The alternative is a page that issues one select per row and never says
   * so; the relation stays something the query asks for with `with()`, rather
   * than something the model goes out to fetch when a caller reads it.
   * Laravel: Model::preventLazyLoading()
   */
  protected checkForLazyLoadingViolation(relation: string): void {
    if (!this.preventsLazyLoading) {
      return;
    }

    throw new Error(
      `Lazy loading violation: the [${this.constructor.name}] model attempted to lazy load the [${relation}] relation.`
    );
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
    // `withoutEvents()` puts this model's lifecycle on hold: the row changes
    // and nobody hears about it.
    if (this.eventsSuppressed) {
      return undefined;
    }

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
