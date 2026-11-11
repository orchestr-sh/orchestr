/**
 * Shared helpers for the factory tests.
 *
 * `Fake.use()` lets tests substitute the optional @faker-js/faker peer
 * dependency with a deterministic provider, so the factory suite runs - and
 * asserts exact generated values - whether or not Faker is installed.
 */

/**
 * A tiny seedable stand-in for the faker generator, exposing the namespaces
 * the test factories rely on. Each call advances an internal cursor, so two
 * providers seeded with the same value produce identical sequences.
 */
export class DeterministicFake {
  private cursor = 0;

  /**
   * Hook invoked by Fake.seed() when this provider is installed.
   */
  setSeed(seed: number): void {
    this.cursor = seed;
  }

  readonly name = {
    fullName: (): string => `Person ${this.tick()}`,
    firstName: (): string => `First ${this.tick()}`,
    lastName: (): string => `Last ${this.tick()}`,
  };

  readonly internet = {
    email: (): string => `person${this.tick()}@example.com`,
    url: (): string => `https://example.test/${this.tick()}`,
  };

  readonly lorem = {
    sentence: (): string => `Sentence ${this.tick()}`,
    paragraph: (): string => `Paragraph ${this.tick()}`,
    words: (count: number = 3): string => Array.from({ length: count }, () => `word${this.tick()}`).join(' '),
  };

  readonly random = {
    number: (options?: { min?: number; max?: number }): number => {
      const min = options?.min ?? 1;
      const max = options?.max ?? 100;

      return min + (this.tick() % (max - min + 1));
    },
    arrayElement: <T>(items: T[]): T => items[this.tick() % items.length],
  };

  /**
   * Advance and return the deterministic cursor.
   */
  private tick(): number {
    return this.cursor++;
  }
}

/**
 * Whether @faker-js/faker is NOT installed.
 *
 * Like the database-driver probes, the optional peer dependency is imported
 * through a variable specifier (the package is optional, so a literal import
 * would fail type checking when it is absent) and only probed at runtime.
 */
export async function fakerIsAbsent(): Promise<boolean> {
  const dynamicImport: (specifier: string) => Promise<any> = (specifier) => import(specifier);

  try {
    await dynamicImport('@faker-js/faker');
    return false;
  } catch {
    return true;
  }
}

/**
 * Flag for `describe.skipIf(FAKER_IS_PRESENT)`.
 */
export const FAKER_ABSENT = await fakerIsAbsent();
