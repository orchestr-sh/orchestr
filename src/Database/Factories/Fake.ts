/**
 * Fake
 *
 * Small adapter in front of the optional `@faker-js/faker` peer dependency.
 * Factories ask the adapter for their generator instead of importing Faker
 * directly, so:
 *
 * - apps that never installed Faker get a clear installation message rather
 *   than silently receiving random data,
 * - tests can substitute a deterministic fake provider with `Fake.use()`
 *   and reproduce the exact same "random" values through `Fake.seed()`.
 *
 * The package is loaded through a variable specifier so it stays out of the
 * static dependency graph - TypeScript and the bundlers never resolve it at
 * build time, and an absent peer dependency only surfaces when `fake()` is
 * actually used.
 */

export type FakeProvider = Record<string, any>;

/**
 * The optional peer dependency backing the fake() helper.
 */
export const FAKER_PACKAGE = '@faker-js/faker';

function notInitializedError(cause?: unknown): Error {
  return new Error(
    `The fake() helper requires the optional "${FAKER_PACKAGE}" peer dependency. ` +
      `Install it and initialize the adapter with "await Fake.load()" ` +
      `(factories do this for you), or substitute a deterministic provider in tests with "Fake.use(provider)".`,
    { cause }
  );
}

let provider: FakeProvider | null = null;
let realFaker: FakeProvider | null = null;
let loading: Promise<FakeProvider> | null = null;
let seedValue: number | null = null;

export class Fake {
  /**
   * Substitute a generator - typically a deterministic fake in tests.
   * Passing null removes the substitution again.
   */
  static use(customProvider: FakeProvider | null): void {
    provider = customProvider;

    if (customProvider && seedValue !== null && typeof customProvider.setSeed === 'function') {
      customProvider.setSeed(seedValue);
    }
  }

  /**
   * The generator behind fake(): the substituted provider when one is set,
   * else the loaded Faker instance, else a clear installation message.
   */
  static current(): FakeProvider {
    if (provider) {
      return provider;
    }

    if (realFaker) {
      return realFaker;
    }

    throw notInitializedError();
  }

  /**
   * Make generated values reproducible. The seed is forwarded to the
   * substituted provider's setSeed() hook and to real Faker's seed() when
   * an instance is loaded; when neither is available yet the value is kept
   * and applied as soon as Faker loads.
   */
  static seed(value: number): number {
    seedValue = value;

    if (realFaker && typeof realFaker.seed === 'function') {
      realFaker.seed(value);
    }

    if (provider && typeof provider.setSeed === 'function') {
      provider.setSeed(value);
    }

    return value;
  }

  /**
   * The seed installed through Fake.seed(), if any.
   */
  static getSeed(): number | null {
    return seedValue;
  }

  /**
   * Eagerly load the optional @faker-js/faker package. Resolves to the
   * generator in use (a substituted provider wins), and rejects with the
   * installation message when the package is absent.
   */
  static async load(): Promise<FakeProvider> {
    if (provider) {
      return provider;
    }

    if (realFaker) {
      return realFaker;
    }

    loading ??= importFaker().catch((error) => {
      throw notInitializedError(error);
    });

    return loading;
  }

  /**
   * Best-effort load used by the factories before they evaluate a
   * definition: never rejects, fake() reports the missing dependency the
   * moment a definition actually asks for generated data.
   */
  static async preload(): Promise<void> {
    try {
      await Fake.load();
    } catch {
      // Absent peer dependency: fake() throws a helpful error on use.
    }
  }

  /**
   * Forget every piece of adapter state. Tests lean on this to start each
   * case from a clean generator.
   */
  static reset(): void {
    provider = null;
    realFaker = null;
    loading = null;
    seedValue = null;
  }
}

/**
 * Import the optional dependency through a variable specifier so neither
 * TypeScript nor the bundlers try to resolve it at build time.
 */
async function importFaker(): Promise<FakeProvider> {
  const dynamicImport: (specifier: string) => Promise<any> = (specifier) => import(specifier);

  const module = await dynamicImport(FAKER_PACKAGE);
  const generator = module?.faker ?? module?.default?.faker ?? module?.default ?? module;

  if (!generator || typeof generator !== 'object') {
    throw new Error(`"${FAKER_PACKAGE}" did not expose a faker generator.`);
  }

  realFaker = generator as FakeProvider;

  if (seedValue !== null && typeof generator.seed === 'function') {
    generator.seed(seedValue);
  }

  return realFaker;
}

/**
 * Access the fake generator, Laravel: fake() / fake('internet.email').
 *
 * Without a key the whole generator comes back; with a (dotted) key the
 * matching faker generator is returned, called with any extra arguments
 * when it is a function.
 */
export function fake(key?: string, ...args: any[]): any {
  const generator = Fake.current();

  if (!key) {
    return generator;
  }

  const segments = key.split('.');
  const leaf = segments.pop() as string;
  const namespace = segments.reduce(
    (carry: any, segment: string) => (carry === undefined ? carry : carry[segment]),
    generator
  );

  if (namespace === undefined) {
    return undefined;
  }

  const value = namespace[leaf];

  return typeof value === 'function' ? value.call(namespace, ...args) : value;
}
