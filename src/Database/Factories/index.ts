/**
 * Factories Index
 *
 * Model factories: deterministic attribute generation, states, sequences,
 * relationship composition and the optional Faker adapter used by tests and
 * seeders.
 */

export { Factory, Sequence, FactoryConfiguration } from './Factory';
export type {
  EnsembleClass,
  FactoryAttributes,
  FactoryHook,
  FactoryState,
  FactoryStateClosure,
  PendingFor,
  PendingHas,
  SequenceClosure,
  SequenceItem,
} from './Factory';

export { FactoryBuilder } from './FactoryBuilder';

export { registerFactory, forgetFactory, factoryForModel, resolveModelFactory } from './HasFactory';
export type { FactoryClass } from './HasFactory';

export { Fake, fake, FAKER_PACKAGE } from './Fake';
export type { FakeProvider } from './Fake';
