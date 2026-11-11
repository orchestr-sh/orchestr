/**
 * ArgonHasher
 *
 * Wraps the optional `argon2` peer dependency behind the standard Hasher
 * contract. The package is resolved lazily, so orchestr works without it
 * and using the driver reports exactly which package to install.
 *
 * Argon2 hashes are PHC strings - `$argon2id$v=19$m=65536,t=4,p=2$<salt>$
 * <digest>` - which is what makes `needsRehash()` able to compare the
 * embedded memory/time/parallelism cost against the live configuration:
 *
 * Laravel: Illuminate\Hashing\ArgonHasher / Argon2IdHasher
 *
 * @example
 * ```typescript
 * app.instance('config', new Config({
 *   hashing: { driver: 'argon2', argon2: { memoryCost: 65536, timeCost: 4, parallelism: 2 } },
 * }));
 * app.register(HashServiceProvider);
 * ```
 */

import type { HashInfo } from './Contracts/Hasher';
import { HashDriverUnavailableException } from './HashDriverUnavailableException';
import { requireOptionalPackage } from './requireOptionalPackage';

export interface Argon2Options {
  /** Memory cost in KiB */
  memoryCost?: number;
  /** Number of iterations */
  timeCost?: number;
  /** Degree of parallelism */
  parallelism?: number;
  /** Digest length in bytes */
  hashLength?: number;
  /** Argon2 variant: argon2id (default), argon2i or argon2d */
  type?: 'argon2i' | 'argon2id' | 'argon2d';
}

/**
 * The slice of the argon2 package this hasher uses
 */
export interface Argon2Module {
  hashSync(value: string, options?: Record<string, any>): string;
  verifySync(hashedValue: string, value: string): boolean;
  argon2i?: number;
  argon2d?: number;
  argon2id?: number;
}

const ALGORITHM = 'argon2';
const DEFAULTS: Required<Omit<Argon2Options, 'type'>> & { type: 'argon2i' | 'argon2id' | 'argon2d' } = {
  memoryCost: 65536,
  timeCost: 4,
  parallelism: 2,
  hashLength: 32,
  type: 'argon2id',
};
const HASH_PATTERN =
  /^\$(argon2i|argon2id|argon2d)\$v=\d+\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+={0,2})\$([A-Za-z0-9+/]+={0,2})$/;

export class ArgonHasher {
  /**
   * Lazily resolved argon2 module; `undefined` = not loaded yet, `null` =
   * the package is not installed
   */
  private loaded?: Argon2Module | null;

  constructor(
    protected options: Argon2Options = {},
    module?: Argon2Module
  ) {
    // Tests and adapters may inject an implementation; production leaves it
    // unset and the package is resolved on first use
    this.loaded = module;
  }

  /**
   * The name of this hasher's driver
   */
  driver(): string {
    return ALGORITHM;
  }

  /**
   * Hash a value with the configured Argon2 parameters
   */
  make(value: string, options: Argon2Options = {}): string {
    const params = this.merge(options);

    this.validate(params);

    const module = this.module();

    const hashOptions: Record<string, any> = {
      type: this.resolveType(module, params.type),
      memoryCost: params.memoryCost,
      timeCost: params.timeCost,
      parallelism: params.parallelism,
      hashLength: params.hashLength,
    };

    return module.hashSync(value, hashOptions);
  }

  /**
   * Verify a candidate against an argon2 hash
   */
  check(value: string, hashedValue: string, options: Argon2Options = {}): boolean {
    if (!HASH_PATTERN.test(hashedValue)) {
      return false;
    }

    // Resolving the module outside the try keeps an unavailable dependency
    // an explicit error rather than a silent false
    const module = this.module();

    try {
      return module.verifySync(hashedValue, value);
    } catch {
      // argon2 throws on malformed hashes and wrong variants; either way
      // the candidate did not verify
      return false;
    }
  }

  /**
   * A hash needs rehashing when its embedded cost parameters (or variant)
   * differ from the current configuration
   */
  needsRehash(hashedValue: string, options: Argon2Options = {}): boolean {
    const parsed = this.parse(hashedValue);

    if (!parsed) {
      return true;
    }

    const current = this.merge(options);

    return (
      parsed.memoryCost !== current.memoryCost ||
      parsed.timeCost !== current.timeCost ||
      parsed.parallelism !== current.parallelism ||
      parsed.type !== current.type
    );
  }

  /**
   * Prove the configured parameters can verify their own output
   */
  verifyConfiguration(value: string = 'password'): void {
    let hash: string;

    try {
      hash = this.make(value);
    } catch (error) {
      if (error instanceof HashDriverUnavailableException) {
        throw error;
      }

      throw new Error(
        `The "${ALGORITHM}" hashing driver cannot hash with the configured options: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error }
      );
    }

    if (!this.check(value, hash)) {
      throw new Error(`The "${ALGORITHM}" hashing driver cannot verify hashes it just created.`);
    }
  }

  /**
   * Parse the variant, cost parameters and salt out of a hash
   */
  info(hashedValue: string): HashInfo | null {
    const parsed = this.parse(hashedValue);

    if (!parsed) {
      return null;
    }

    return {
      algo: parsed.type,
      options: {
        memoryCost: parsed.memoryCost,
        timeCost: parsed.timeCost,
        parallelism: parsed.parallelism,
      },
      salt: parsed.salt,
    };
  }

  /**
   * Merge call options over configured options over defaults
   */
  protected merge(options: Argon2Options): typeof DEFAULTS {
    return {
      memoryCost: options.memoryCost ?? this.options.memoryCost ?? DEFAULTS.memoryCost,
      timeCost: options.timeCost ?? this.options.timeCost ?? DEFAULTS.timeCost,
      parallelism: options.parallelism ?? this.options.parallelism ?? DEFAULTS.parallelism,
      hashLength: options.hashLength ?? this.options.hashLength ?? DEFAULTS.hashLength,
      type: options.type ?? this.options.type ?? DEFAULTS.type,
    };
  }

  /**
   * Fail fast on parameter sets argon2 cannot honour, so misconfiguration
   * surfaces at make() time with a clear message
   */
  protected validate(params: typeof DEFAULTS): void {
    if (!Number.isInteger(params.memoryCost) || params.memoryCost < 8 * params.parallelism) {
      throw new Error(
        `Invalid argon2 memoryCost [${params.memoryCost}]: must be an integer of at least 8 * parallelism (${8 * params.parallelism}).`
      );
    }

    if (!Number.isInteger(params.timeCost) || params.timeCost < 1) {
      throw new Error(`Invalid argon2 timeCost [${params.timeCost}]: must be an integer of at least 1.`);
    }

    if (!Number.isInteger(params.parallelism) || params.parallelism < 1) {
      throw new Error(`Invalid argon2 parallelism [${params.parallelism}]: must be an integer of at least 1.`);
    }

    if (!Number.isInteger(params.hashLength) || params.hashLength < 4) {
      throw new Error(`Invalid argon2 hashLength [${params.hashLength}]: must be an integer of at least 4.`);
    }
  }

  /**
   * Map the configured variant onto the module's numeric type constants
   */
  protected resolveType(module: Argon2Module, type: typeof DEFAULTS.type): number | undefined {
    const constant = module[type];

    return typeof constant === 'number' ? constant : undefined;
  }

  /**
   * Split a PHC argon2 string into its parts
   */
  private parse(hashedValue: string): {
    type: 'argon2i' | 'argon2id' | 'argon2d';
    memoryCost: number;
    timeCost: number;
    parallelism: number;
    salt: string;
  } | null {
    const match = typeof hashedValue === 'string' ? HASH_PATTERN.exec(hashedValue) : null;

    if (!match) {
      return null;
    }

    return {
      type: match[1] as 'argon2i' | 'argon2id' | 'argon2d',
      memoryCost: Number(match[2]),
      timeCost: Number(match[3]),
      parallelism: Number(match[4]),
      salt: match[5],
    };
  }

  /**
   * Resolve the optional argon2 package once, caching the miss so a missing
   * dependency reports itself identically every time
   */
  protected module(): Argon2Module {
    if (this.loaded) {
      return this.loaded;
    }

    if (this.loaded === null) {
      throw new HashDriverUnavailableException('argon2', ALGORITHM);
    }

    try {
      // Optional native peer dependency, resolved lazily so orchestr works
      // unchanged while it is not installed
      const loaded = requireOptionalPackage('argon2') as Argon2Module;

      if (typeof loaded.hashSync !== 'function' || typeof loaded.verifySync !== 'function') {
        throw new Error('Package does not expose hashSync()/verifySync().');
      }

      this.loaded = loaded;

      return loaded;
    } catch (error) {
      this.loaded = null;

      throw new HashDriverUnavailableException('argon2', ALGORITHM, error);
    }
  }
}
