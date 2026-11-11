/**
 * Factory
 *
 * Base class for model factories, the Laravel-shaped attribute builders used
 * by tests and seeders. A factory knows how to generate an attribute set
 * (`definition()`), how to modify it (`state()`, `sequence()`), how to relate
 * it to other factories (`for()`, `has()`) and whether to hand back plain
 * attributes (`raw()`), unsaved models (`make()`) or persisted models
 * (`create()`).
 *
 * Like Laravel's own factories, instances are immutable: every fluent
 * modifier (state/count/sequence/for/has/after*) returns a new factory, so a
 * shared `User.factory()` can be extended per-test without leaking changes.
 *
 * SRP: factories build attributes, Ensembles persist them, and the
 * FactoryBuilder composes relationships around both.
 * Laravel: Illuminate\Database\Eloquent\Factories\Factory
 */

import { Ensemble } from '@/Database/Ensemble/Ensemble';
import { EnsembleCollection } from '@/Database/Ensemble/EnsembleCollection';
import { BelongsTo } from '@/Database/Ensemble/Relations/BelongsTo';
import { BelongsToMany } from '@/Database/Ensemble/Relations/BelongsToMany';
import { HasMany } from '@/Database/Ensemble/Relations/HasMany';
import { HasOne } from '@/Database/Ensemble/Relations/HasOne';
import { MorphMany } from '@/Database/Ensemble/Relations/MorphMany';
import { MorphMap } from '@/Database/Ensemble/Relations/MorphMap';
import { MorphOne } from '@/Database/Ensemble/Relations/MorphOne';
import { MorphTo } from '@/Database/Ensemble/Relations/MorphTo';
import { Relation } from '@/Database/Ensemble/Relations/Relation';
import { Str } from '@/Support/Str';
import { FactoryBuilder } from './FactoryBuilder';
import { Fake } from './Fake';

/**
 * The constructor shape every Ensemble model satisfies.
 */
export type EnsembleClass<TModel extends Ensemble = Ensemble> = new (
  attributes?: Record<string, any>,
  fromDatabase?: boolean
) => TModel;

/**
 * A raw attribute bag produced by a factory definition or state.
 */
export type FactoryAttributes = Record<string, any>;

/**
 * A state transformation: either an attribute bag to merge over the
 * definition, or a closure receiving the attributes built so far (plus the
 * relationship parent, when one is being created around it).
 */
export type FactoryStateClosure = (
  attributes: FactoryAttributes,
  parent?: Ensemble
) => FactoryAttributes | Promise<FactoryAttributes>;

export type FactoryState = FactoryAttributes | FactoryStateClosure | Sequence;

/**
 * A single step of a sequence: attributes, or a closure that gets the
 * sequence itself so it can read `sequence.index`.
 */
export type SequenceClosure = (
  sequence: Sequence,
  attributes: FactoryAttributes,
  parent?: Ensemble
) => FactoryAttributes | Promise<FactoryAttributes>;

export type SequenceItem = FactoryAttributes | SequenceClosure;

/**
 * Lifecycle hooks. `afterMaking` runs once a model is built but not saved;
 * `afterCreating` runs after persistence (and after its has() children).
 * Hooks may return a promise; the factory awaits them.
 */
export type FactoryHook = (model: Ensemble, parent?: Ensemble) => unknown;

/**
 * A pending has() relationship: a related factory plus an optional count
 * override and relationship name.
 */
export interface PendingHas {
  factory: Factory<Ensemble>;
  count?: number;
  relationship?: string;
}

/**
 * A pending for() relationship: the parent factory (or an existing model
 * instance to associate) plus the relationship name it is reachable under.
 */
export interface PendingFor {
  factory?: Factory<Ensemble>;
  model?: Ensemble;
  relationship?: string;
}

/**
 * A for() parent resolved for one record.
 */
interface ParentAssociation {
  relationship: string;
  parent: Ensemble;
}

/**
 * A sequence cycles through its items one per built record, the Laravel
 * `Sequence` state: `factory().count(3).sequence({ admin: true }, { admin: false })`.
 * Items may be attribute bags or closures that receive the sequence (and its
 * absolute `index`) so values can be derived deterministically.
 */
export class Sequence {
  /**
   * How many times the sequence has been consumed so far.
   */
  public index: number = 0;

  /**
   * The states cycled through, one per built record.
   */
  private readonly items: SequenceItem[];

  constructor(...items: SequenceItem[]) {
    if (items.length === 0) {
      throw new Error('A factory sequence requires at least one state.');
    }

    this.items = items;
  }

  /**
   * The number of states in the sequence.
   */
  get count(): number {
    return this.items.length;
  }

  /**
   * Resolve the next state, cycling through the items. The sequence is
   * handed to closures before the index advances, so `sequence.index`
   * reports the iteration number of the value being built.
   */
  async invoke(attributes: FactoryAttributes = {}, parent?: Ensemble): Promise<FactoryAttributes> {
    const item = this.items[this.index % this.items.length];
    const state = typeof item === 'function' ? item(this, attributes, parent) : item;

    this.index += 1;

    return state;
  }
}

/**
 * Global, cross-factory hooks registered through Factory.configure().
 */
export class FactoryConfiguration {
  private afterMakingHooks: Array<{ callback: FactoryHook; modelClass?: EnsembleClass<any> }> = [];
  private afterCreatingHooks: Array<{ callback: FactoryHook; modelClass?: EnsembleClass<any> }> = [];

  /**
   * Register a hook fired after every model a factory makes. Pass a model
   * class to scope the hook to that model only.
   */
  afterMaking(callback: FactoryHook, modelClass?: EnsembleClass<any>): this {
    this.afterMakingHooks.push({ callback, modelClass });
    return this;
  }

  /**
   * Register a hook fired after every model a factory creates.
   */
  afterCreating(callback: FactoryHook, modelClass?: EnsembleClass<any>): this {
    this.afterCreatingHooks.push({ callback, modelClass });
    return this;
  }

  /**
   * Run the registered afterMaking hooks for a model.
   */
  async fireAfterMaking(model: Ensemble): Promise<void> {
    for (const hook of this.afterMakingHooks) {
      if (!hook.modelClass || model instanceof hook.modelClass) {
        await hook.callback(model);
      }
    }
  }

  /**
   * Run the registered afterCreating hooks for a model.
   */
  async fireAfterCreating(model: Ensemble, parent?: Ensemble): Promise<void> {
    for (const hook of this.afterCreatingHooks) {
      if (!hook.modelClass || model instanceof hook.modelClass) {
        await hook.callback(model, parent);
      }
    }
  }

  /**
   * Forget every registered hook. Tests lean on this for isolation.
   */
  reset(): this {
    this.afterMakingHooks = [];
    this.afterCreatingHooks = [];
    return this;
  }
}

type NormalizedState = FactoryStateClosure;

interface FactoryClonePatch {
  recordCount?: number | null;
  stateStack?: NormalizedState[];
  hasStack?: PendingHas[];
  forStack?: PendingFor[];
  makingCallbacks?: FactoryHook[];
  creatingCallbacks?: FactoryHook[];
}

function normalizeState(state: FactoryState): NormalizedState {
  if (state instanceof Sequence) {
    return (attributes, parent) => state.invoke(attributes, parent);
  }

  if (typeof state === 'function') {
    return state as FactoryStateClosure;
  }

  const attributes = state;
  return () => attributes;
}

export abstract class Factory<TModel extends Ensemble> {
  /**
   * The model the factory builds, declared by the concrete factory with the
   * same convention used to pair models and factories for lookup:
   * `User` <-> `UserFactory`. Laravel: Factory::$model
   */
  static model?: EnsembleClass<any>;

  /**
   * The number of models the next make()/create() run should build. A null
   * count produces a single model instead of a list. Laravel: $count
   */
  protected recordCount: number | null = null;

  /**
   * State transformations applied over the definition, in order.
   * Laravel: $states
   */
  protected stateStack: NormalizedState[] = [];

  /**
   * Child relationships built around each created parent. Laravel: $has
   */
  protected hasStack: PendingHas[] = [];

  /**
   * Parent relationships the built models belong to. Laravel: $for
   */
  protected forStack: PendingFor[] = [];

  /**
   * Instance-level afterMaking / afterCreating callbacks.
   * Laravel: $afterMaking, $afterCreating
   */
  protected makingCallbacks: FactoryHook[] = [];
  protected creatingCallbacks: FactoryHook[] = [];

  /**
   * States registered under a name with state(fn, 'name') - keyed per
   * factory class so named states never leak across factories.
   */
  private static stateRegistry: Map<unknown, Record<string, NormalizedState>> = new Map();

  /**
   * Global hooks registered through Factory.configure().
   */
  private static globalConfiguration: FactoryConfiguration = new FactoryConfiguration();

  /**
   * Define the model's default state. May return a promise so definitions
   * can await whatever asynchronous data generation they like.
   */
  abstract definition(): FactoryAttributes | Promise<FactoryAttributes>;

  /**
   * Get a new factory instance for the factory's model.
   * Laravel: Factory::new()
   */
  static new<TFactory extends Factory<any>>(this: new () => TFactory, attributes: FactoryAttributes = {}): TFactory {
    return new this().state(attributes).configure() as TFactory;
  }

  /**
   * Get a new factory instance that builds the given number of models.
   * Laravel: Factory::times()
   */
  static times<TFactory extends Factory<any>>(this: new () => TFactory, count: number): TFactory {
    const factory = new this().configure() as TFactory;

    return factory.count(count);
  }

  /**
   * Register global afterMaking/afterCreating hooks for every factory. With
   * no callback the configuration object is returned for chaining.
   */
  static configure(callback?: (config: FactoryConfiguration) => unknown): FactoryConfiguration {
    if (callback) {
      callback(Factory.globalConfiguration);
    }

    return Factory.globalConfiguration;
  }

  /**
   * Configure the factory: the override point subclasses use to attach
   * afterMaking/afterCreating callbacks. Called by Factory::new().
   * Laravel: Factory::configure()
   */
  configure(): this {
    return this;
  }

  /**
   * Specify how many models the next make()/create() should build.
   * Laravel: Factory::count()
   */
  count(count: number | null): this {
    return this.cloneWith({ recordCount: count });
  }

  /**
   * Alias of count() that reads naturally for fixed record counts.
   */
  times(count: number): this {
    return this.count(count);
  }

  /**
   * Add a state transformation over the definition. Pass a name to register
   * the state so it can be applied again with `state('name')`.
   * Laravel: Factory::state()
   */
  state(state: FactoryState | string, name?: string): this {
    const normalized = typeof state === 'string' ? this.requireNamedState(state) : normalizeState(state);

    if (name !== undefined) {
      this.stateRegistry()[name] = normalized;
    }

    return this.cloneWith({ stateStack: [...this.stateStack, normalized] });
  }

  /**
   * Add a sequenced state transformation: each built record consumes the
   * next item, cycling back to the start once the items run out.
   * Laravel: Factory::sequence()
   */
  sequence(...items: Array<SequenceItem | SequenceItem[]>): this {
    return this.state(new Sequence(...items.flat(1)));
  }

  /**
   * Define a parent relationship for the models: the related factory (or an
   * existing model instance) is associated through the relationship's
   * foreign key. Laravel: Factory::for()
   */
  for(parent: Factory<Ensemble> | Ensemble, relationship?: string): this {
    const entry: PendingFor = { relationship };

    if (parent instanceof Ensemble) {
      entry.model = parent;
    } else {
      entry.factory = parent;
    }

    return this.cloneWith({ forStack: [...this.forStack, entry] });
  }

  /**
   * Define a child relationship for the models. The relationship name is
   * guessed from the related model by convention (Post -> posts) unless it
   * is passed explicitly. Laravel: Factory::has()
   */
  has(factory: Factory<Ensemble>, countOrRelationship?: number | string, relationship?: string): this {
    const entry: PendingHas = { factory, relationship };

    if (typeof countOrRelationship === 'number') {
      entry.count = countOrRelationship;
    } else if (typeof countOrRelationship === 'string') {
      entry.relationship = countOrRelationship;
    }

    return this.cloneWith({ hasStack: [...this.hasStack, entry] });
  }

  /**
   * Add an "after making" callback for built (unsaved) models.
   * Laravel: Factory::afterMaking()
   */
  afterMaking(callback: (model: TModel) => unknown): this {
    return this.cloneWith({ makingCallbacks: [...this.makingCallbacks, callback as FactoryHook] });
  }

  /**
   * Add an "after creating" callback for persisted models. The callback also
   * receives the relationship parent, if one was created around the model.
   * Laravel: Factory::afterCreating()
   */
  afterCreating(callback: (model: TModel, parent?: Ensemble) => unknown): this {
    return this.cloneWith({ creatingCallbacks: [...this.creatingCallbacks, callback as FactoryHook] });
  }

  /**
   * Create model instances without persisting them. Returns a single model
   * when no count was set, and a list otherwise. for() parents are created
   * (persisted) like Laravel; has() children only apply to create().
   * Laravel: Factory::make()
   */
  async make(attributes: FactoryAttributes = {}, parent?: Ensemble): Promise<TModel | TModel[]> {
    if (Object.keys(attributes).length > 0) {
      return this.state(attributes).make({}, parent);
    }

    const models = await FactoryBuilder.new(this).make(parent);

    return this.recordCount === null ? models[0] : models;
  }

  /**
   * Create a single unsaved model, whatever count is pending.
   */
  async makeOne(attributes: FactoryAttributes = {}, parent?: Ensemble): Promise<TModel> {
    return this.cloneWith({ recordCount: null }).make(attributes, parent) as Promise<TModel>;
  }

  /**
   * Build a list of unsaved models. Pass a count, or one attribute bag per
   * record to layer per-record states on top of the factory's definition.
   * Laravel: Factory::makeMany()
   */
  async makeMany(records?: number | FactoryAttributes[]): Promise<TModel[]> {
    const models: TModel[] = [];

    for (const record of this.expandRecords(records)) {
      models.push((await this.cloneWith({ recordCount: null }).state(record).make()) as TModel);
    }

    return models;
  }

  /**
   * Instantiate the models and persist them, then persist their has()
   * relationships. Returns a single model when no count was set, and a list
   * otherwise. Laravel: Factory::create()
   */
  async create(attributes: FactoryAttributes = {}, parent?: Ensemble): Promise<TModel | TModel[]> {
    if (Object.keys(attributes).length > 0) {
      return this.state(attributes).create({}, parent);
    }

    const models = await FactoryBuilder.new(this).create(parent);

    return this.recordCount === null ? models[0] : models;
  }

  /**
   * Persist a single model, whatever count is pending.
   */
  async createOne(attributes: FactoryAttributes = {}, parent?: Ensemble): Promise<TModel> {
    return this.cloneWith({ recordCount: null }).create(attributes, parent) as Promise<TModel>;
  }

  /**
   * Persist a list of models. Pass a count, or one attribute bag per record.
   * Laravel: Factory::createMany()
   */
  async createMany(records?: number | FactoryAttributes[]): Promise<TModel[]> {
    const models: TModel[] = [];

    for (const record of this.expandRecords(records)) {
      models.push((await this.cloneWith({ recordCount: null }).state(record).create()) as TModel);
    }

    return models;
  }

  /**
   * Get the evaluated attributes as plain records - no model instances.
   * Relationship factories are still resolved (created) so the foreign keys
   * hold real keys, matching Laravel's raw(). Laravel: Factory::raw()
   */
  async raw(attributes: FactoryAttributes = {}, parent?: Ensemble): Promise<FactoryAttributes | FactoryAttributes[]> {
    if (Object.keys(attributes).length > 0) {
      return this.state(attributes).raw({}, parent);
    }

    const records = await FactoryBuilder.new(this).raw(parent);

    return this.recordCount === null ? records[0] : records;
  }

  /**
   * Get a new model instance of the factory's model. Attributes are written
   * through setAttribute() so mutators still run while mass assignment
   * protection stays disabled - factories fill models the way Laravel's
   * unguarded() does.
   */
  newModel(attributes: FactoryAttributes = {}): TModel {
    const ModelClass = this.modelClass();
    const model = new ModelClass();

    for (const [key, value] of Object.entries(attributes)) {
      model.setAttribute(key, value);
    }

    return model;
  }

  /**
   * The model class the factory builds.
   */
  modelClass(): EnsembleClass<TModel> {
    const model = (this.constructor as typeof Factory).model as EnsembleClass<TModel> | undefined;

    if (!model) {
      throw new Error(
        `The [${this.constructor.name}] factory must declare "static model" - or override newModel() - so it knows which Ensemble to build.`
      );
    }

    return model;
  }

  /**
   * The name of the model the factory builds. Laravel: Factory::modelName()
   */
  modelName(): string {
    return this.modelClass().name;
  }

  /**
   * Resolve the evaluated attribute array for one record: definition, then
   * the for() foreign keys, then every state in order, then factory/model/
   * closure attribute values. Used by raw() and the FactoryBuilder.
   * @internal
   */
  async buildAttributes(parent?: Ensemble): Promise<FactoryAttributes> {
    return (await this.buildRecordData(parent)).attributes;
  }

  /**
   * Build one unsaved model, associating its for() parents.
   * @internal
   */
  async makeRecord(parent?: Ensemble): Promise<TModel> {
    const { attributes, parents } = await this.buildRecordData(parent);
    const model = this.newModel(attributes);

    for (const association of parents) {
      model.setRelation(association.relationship, association.parent);
    }

    return model;
  }

  /**
   * Persist one already-made model and then persist its has() children.
   * @internal
   */
  async persistRecord(model: TModel, parent?: Ensemble): Promise<void> {
    await model.save();

    for (const entry of this.hasStack) {
      await this.createHasRelationship(model, entry, parent);
    }
  }

  /**
   * The number of records the next make()/create() will build.
   * @internal
   */
  currentCount(): number {
    return this.recordCount ?? 1;
  }

  /**
   * Run the afterMaking callbacks (instance hooks first, then global ones).
   * @internal
   */
  async callAfterMaking(models: TModel[]): Promise<void> {
    for (const model of models) {
      for (const callback of this.makingCallbacks) {
        await callback(model);
      }

      await Factory.globalConfiguration.fireAfterMaking(model);
    }
  }

  /**
   * Run the afterCreating callbacks (instance hooks first, then global ones).
   * @internal
   */
  async callAfterCreating(models: TModel[], parent?: Ensemble): Promise<void> {
    for (const model of models) {
      for (const callback of this.creatingCallbacks) {
        await callback(model, parent);
      }

      await Factory.globalConfiguration.fireAfterCreating(model, parent);
    }
  }

  /**
   * Create the related models for one has() entry, wired through the
   * relationship. Laravel: Relationship::createFor()
   */
  protected async createHasRelationship(parent: Ensemble, entry: PendingHas, grandparent?: Ensemble): Promise<void> {
    const relationship = entry.relationship ?? this.guessRelationship(entry.factory.modelName());
    const relation = this.relationOn(parent, relationship);
    const childFactory = entry.count !== undefined ? entry.factory.count(entry.count) : entry.factory;

    const attributes: FactoryAttributes = {};

    if (
      relation instanceof HasOne ||
      relation instanceof HasMany ||
      relation instanceof MorphOne ||
      relation instanceof MorphMany
    ) {
      attributes[relation.getForeignKeyName()] = parent.getAttribute(relation.getLocalKeyName());

      if (relation instanceof MorphOne || relation instanceof MorphMany) {
        attributes[relation.getMorphType()] = MorphMap.getMorphedModel(parent);
      }
    } else if (!(relation instanceof BelongsToMany)) {
      throw new Error(
        `The has() relationship [${relationship}] on [${parent.constructor.name}] must be a hasOne, hasMany, belongsToMany or morph relationship - use for() for belongsTo parents.`
      );
    }

    const created = await childFactory.state(attributes).create([], grandparent);
    const related = Array.isArray(created) ? created : [created];

    if (relation instanceof BelongsToMany) {
      await relation.attach(related.map((model) => model.getKey()));
      parent.setRelation(relationship, new EnsembleCollection<Ensemble>(related));
      return;
    }

    if (relation instanceof HasOne || relation instanceof MorphOne) {
      parent.setRelation(relationship, related[0] ?? null);
      return;
    }

    parent.setRelation(relationship, new EnsembleCollection<Ensemble>(related));
  }

  /**
   * Build the attribute array plus the resolved for() parents for one record.
   */
  protected async buildRecordData(
    parent?: Ensemble
  ): Promise<{ attributes: FactoryAttributes; parents: ParentAssociation[] }> {
    // Definitions may lean on the fake() helper; make sure the adapter is
    // ready before evaluating them. Absent peer dependencies surface through
    // fake() itself rather than breaking static definitions.
    await Fake.preload();

    const definition = await this.definition();

    let attributes: FactoryAttributes = { ...definition };

    // for() foreign keys resolve before user states, so a state can still
    // override them, the way Laravel prepends the parent resolvers.
    const resolved = await this.resolveForStack();
    attributes = { ...attributes, ...resolved.attributes };

    for (const state of this.stateStack) {
      attributes = { ...attributes, ...(await state(attributes, parent)) };
    }

    return { attributes: await this.expandAttributes(attributes), parents: resolved.parents };
  }

  /**
   * Evaluate the for() stack: create (or reuse) each parent and translate it
   * into the foreign key attributes of this factory's model.
   */
  protected async resolveForStack(): Promise<{ attributes: FactoryAttributes; parents: ParentAssociation[] }> {
    const attributes: FactoryAttributes = {};
    const parents: ParentAssociation[] = [];

    for (const entry of this.forStack) {
      const relationship = entry.relationship ?? this.guessForRelationship(entry);
      const relation = this.relationOn(this.newModel(), relationship);
      const parent = entry.model ?? (await this.createForParent(entry));

      if (relation instanceof BelongsTo) {
        attributes[relation.getForeignKeyName()] = parent.getAttribute(relation.getOwnerKeyName());
      } else if (relation instanceof MorphTo) {
        attributes[relation.getForeignKeyName()] = parent.getKey();
        attributes[relation.getMorphType()] = MorphMap.getMorphedModel(parent);
      } else {
        throw new Error(
          `The for() relationship [${relationship}] on [${this.modelName()}] must be a belongsTo or morphTo relationship.`
        );
      }

      parents.push({ relationship, parent });
    }

    return { attributes, parents };
  }

  /**
   * Turn attribute values into underlying values: factory instances create
   * their model (and yield its key), Ensemble instances yield their key, and
   * closures are evaluated against the attributes resolved so far.
   * Laravel: Factory::expandAttributes()
   */
  protected async expandAttributes(attributes: FactoryAttributes): Promise<FactoryAttributes> {
    const expanded: FactoryAttributes = { ...attributes };

    for (const [key, value] of Object.entries(expanded)) {
      expanded[key] = await this.resolveRelationValue(value);
    }

    for (const [key, value] of Object.entries(expanded)) {
      if (typeof value === 'function') {
        const produced = await (value as (attributes: FactoryAttributes) => any)(expanded);
        expanded[key] = await this.resolveRelationValue(produced);
      }
    }

    return expanded;
  }

  /**
   * Instantiate the parent behind a for() entry. for() parents are persisted
   * even when the factory itself only makes models - Laravel's behaviour, so
   * the foreign key always carries a real key.
   */
  protected async createForParent(entry: PendingFor): Promise<Ensemble> {
    const factory = entry.factory;

    if (!factory) {
      throw new Error('A for() relationship requires a factory or an existing model instance.');
    }

    const created = await factory.create();

    return Array.isArray(created) ? created[0] : created;
  }

  /**
   * Call the relationship method on a model instance and verify it returned
   * a Relation.
   */
  protected relationOn(model: Ensemble, relationship: string): Relation<Ensemble, Ensemble> {
    const method = (model as any)[relationship];

    if (typeof method !== 'function') {
      throw new Error(
        `Unable to resolve relationship [${relationship}] on model [${model.constructor.name}]. Pass the relationship name to for()/has(), or define the relationship on the model.`
      );
    }

    const relation = method.call(model);

    if (!(relation instanceof Relation)) {
      throw new Error(`[${relationship}] on [${model.constructor.name}] must return a Relation instance.`);
    }

    return relation;
  }

  /**
   * Guess the has() relationship name from the related model: Post -> posts,
   * falling back to the singular form (post) like Laravel.
   */
  protected guessRelationship(relatedModelName: string): string {
    const parent = this.newModel();
    const guess = Str.camel(Str.plural(relatedModelName));

    if (typeof (parent as any)[guess] === 'function') {
      return guess;
    }

    return Str.camel(Str.singular(relatedModelName));
  }

  /**
   * Guess the for() relationship name from the parent model: User -> user.
   */
  protected guessForRelationship(entry: PendingFor): string {
    const relatedName = entry.model?.constructor.name ?? entry.factory?.modelName();

    if (!relatedName) {
      throw new Error('A for() relationship requires a factory or an existing model instance to guess its name from.');
    }

    return Str.camel(relatedName);
  }

  /**
   * Expand a factory/model attribute to its underlying key value; anything
   * else is returned as-is.
   */
  protected async resolveRelationValue(value: any): Promise<any> {
    if (value instanceof Factory) {
      const created = await value.create();

      return Array.isArray(created) ? created[0]?.getKey() : created.getKey();
    }

    if (value instanceof Ensemble) {
      return value.getKey();
    }

    return value;
  }

  /**
   * Normalize a count or records list into one attribute bag per model.
   */
  private expandRecords(records?: number | FactoryAttributes[]): FactoryAttributes[] {
    if (Array.isArray(records)) {
      return records;
    }

    const count = typeof records === 'number' ? records : (this.recordCount ?? 1);

    return Array.from({ length: Math.max(count, 0) }, () => ({}));
  }

  /**
   * Look up a state registered under a name anywhere on the factory's class
   * chain.
   */
  private requireNamedState(name: string): NormalizedState {
    let ctor: unknown = this.constructor;

    while (typeof ctor === 'function') {
      const state = Factory.stateRegistry.get(ctor)?.[name];

      if (state) {
        return state;
      }

      ctor = Object.getPrototypeOf(ctor);
    }

    throw new Error(`The [${this.constructor.name}] factory has no state registered under the name [${name}].`);
  }

  /**
   * The state registry owned by this factory's class.
   */
  private stateRegistry(): Record<string, NormalizedState> {
    const ctor = this.constructor as unknown;
    let registry = Factory.stateRegistry.get(ctor);

    if (!registry) {
      registry = {};
      Factory.stateRegistry.set(ctor, registry);
    }

    return registry;
  }

  /**
   * Produce a copy of this factory with the given fields patched. Clones
   * share mutable sequence objects, so sequence indices keep cycling across
   * the records one make()/create() builds.
   */
  protected cloneWith(patch: FactoryClonePatch = {}): this {
    const cloned = Object.create(Object.getPrototypeOf(this) as object) as this;

    Object.assign(cloned, this, patch);

    return cloned;
  }
}
