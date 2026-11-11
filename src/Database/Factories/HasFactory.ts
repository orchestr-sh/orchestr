/**
 * HasFactory
 *
 * The single factory-resolution convention shared by Ensemble.factory(), the
 * global factory() helper and seeders (DRY). A model's factory is found by:
 *
 *   1. a `static newFactory()` override on the model, which may return a
 *      factory instance directly, or
 *   2. the registry filled by `registerFactory()` - the convention pairing
 *      `User` with `UserFactory` (class-name + 'Factory').
 *
 * Node has no PHP-style autoload-by-namespace, so defining a factory class
 * and registering it (`registerFactory(UserFactory)`) is what makes the
 * `User -> UserFactory` convention hold at runtime.
 *
 * Laravel: Illuminate\Database\Eloquent\Factories\HasFactory + Factory::resolveFactoryName()
 */

import type { Ensemble } from '@/Database/Ensemble/Ensemble';
import type { EnsembleClass, Factory, FactoryState } from './Factory';

/**
 * The constructor shape of a factory class: instantiable, and paired with
 * the model it builds through its `static model`.
 */
export type FactoryClass<TModel extends Ensemble = Ensemble> = {
  new (): Factory<TModel>;
  model?: EnsembleClass<TModel>;
  name: string;
};

/**
 * Model class -> factory class. Keyed by the class itself, so two different
 * `User` classes in different contexts never collide.
 */
const registry = new WeakMap<object, FactoryClass<any>>();

/**
 * Pair a factory class with its model by convention, making
 * `User.factory()` resolve `UserFactory`. The factory must declare
 * `static model = User`, or the model can be passed explicitly.
 */
export function registerFactory<TModel extends Ensemble>(
  factoryClass: FactoryClass<TModel>,
  modelClass?: EnsembleClass<TModel>
): FactoryClass<TModel> {
  const model = modelClass ?? factoryClass.model;

  if (!model) {
    throw new Error(
      `The [${factoryClass.name}] factory must declare "static model = <Model>" - or the model class must be passed to registerFactory() - so [${factoryClass.name.replace(/Factory$/, '')}] can be paired with its model by convention.`
    );
  }

  if (!factoryClass.model) {
    (factoryClass as { model?: EnsembleClass<TModel> }).model = model;
  }

  registry.set(model as unknown as object, factoryClass);

  return factoryClass;
}

/**
 * Remove a model's registered factory. Mostly useful to tests that need to
 * observe the "no factory registered" path.
 */
export function forgetFactory(modelClass: EnsembleClass<Ensemble> | (new (...args: any[]) => any)): void {
  registry.delete(modelClass as unknown as object);
}

/**
 * A fresh factory instance for the given model class, resolved through the
 * convention described above. Laravel: Factory::factoryForModel()
 */
export function factoryForModel<TModel extends Ensemble>(modelClass: EnsembleClass<TModel>): Factory<TModel> {
  // 1. The model's own newFactory() override wins when it returns a factory.
  const newFactoryMethod = (modelClass as { newFactory?: () => Factory<TModel> | null }).newFactory;

  if (typeof newFactoryMethod === 'function') {
    const overridden = newFactoryMethod.call(modelClass);

    if (overridden) {
      return overridden;
    }
  }

  // 2. Otherwise the User -> UserFactory registry convention applies.
  const factoryClass = registry.get(modelClass as unknown as object);

  if (!factoryClass) {
    throw new Error(
      `Unable to locate a factory for model [${modelClass.name}]. Create a [${modelClass.name}Factory] class extending Factory (with "static model = ${modelClass.name}"), pair them with registerFactory(${modelClass.name}Factory), or override the model's static newFactory().`
    );
  }

  // newFactory()/registerFactory() pair the class with the model; mimic
  // Laravel's $factory::new(): build, then run the configure() hook.
  const factory = new (factoryClass as unknown as new () => Factory<TModel>)();

  return factory.configure();
}

/**
 * Resolve a model's factory and apply the `Model.factory(count, state)`
 * arguments. Used by Ensemble.factory(), the factory() helper and seeders -
 * one convention, one implementation.
 */
export function resolveModelFactory<TModel extends Ensemble>(
  modelClass: EnsembleClass<TModel>,
  countOrState?: number | FactoryState,
  state?: FactoryState
): Factory<TModel> {
  const factory = factoryForModel(modelClass);

  const count = typeof countOrState === 'number' ? countOrState : null;
  const initial = countOrState === undefined || typeof countOrState === 'number' ? (state ?? {}) : countOrState;

  return factory.count(count).state(initial);
}
