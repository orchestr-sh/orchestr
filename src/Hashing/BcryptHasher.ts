/**
 * BcryptHasher
 *
 * Wraps the optional `bcrypt` peer dependency behind the standard Hasher
 * contract. The native package is only loaded when a hash is actually made
 * or checked - installing this orchestr without bcrypt keeps everything
 * else working and produces a clear, actionable error when the driver is
 * used.
 *
 * Laravel: Illuminate\Hashing\BcryptHasher
 *
 * @example
 * ```typescript
 * app.instance('config', new Config({ hashing: { driver: 'bcrypt', bcrypt: { rounds: 12 } } }));
 * app.register(HashServiceProvider);
 *
 * const hash = Hash.make('secret'); // "$2b$12$..."
 * Hash.check('secret', hash); // true
 * ```
 */

import type { HashInfo } from './Contracts/Hasher';
import { HashDriverUnavailableException } from './HashDriverUnavailableException';
import { requireOptionalPackage } from './requireOptionalPackage';

export interface BcryptOptions {
  /** Cost factor; bcrypt runs 2^rounds key expansion cycles */
  rounds?: number;
}

/**
 * The slice of the bcrypt package this hasher uses (sync API, so hashing
 * stays a synchronous operation like the rest of the Hasher contract)
 */
export interface BcryptModule {
  hashSync(value: string, rounds: number): string;
  compareSync(value: string, hashedValue: string): boolean;
}

const ALGORITHM = 'bcrypt';
const DEFAULT_ROUNDS = 12;
const HASH_PATTERN = /^\$2[aby]\$(\d{2})\$[./A-Za-z0-9]{53}$/;

export class BcryptHasher {
  /**
   * Lazily resolved bcrypt module; `undefined` = not loaded yet, `null` =
   * the package is not installed
   */
  private loaded?: BcryptModule | null;

  constructor(
    protected options: BcryptOptions = {},
    module?: BcryptModule
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
   * Hash a value at the configured cost
   */
  make(value: string, options: BcryptOptions = {}): string {
    const rounds = options.rounds ?? this.options.rounds ?? DEFAULT_ROUNDS;

    if (!Number.isInteger(rounds) || rounds < 4 || rounds > 31) {
      throw new Error(`Invalid bcrypt rounds [${rounds}]: must be an integer between 4 and 31.`);
    }

    return this.module().hashSync(value, rounds);
  }

  /**
   * Compare a candidate against a bcrypt hash
   */
  check(value: string, hashedValue: string, options: BcryptOptions = {}): boolean {
    if (!HASH_PATTERN.test(hashedValue)) {
      return false;
    }

    // Resolving the module outside the try keeps an unavailable dependency
    // an explicit error rather than a silent false
    const module = this.module();

    try {
      return module.compareSync(value, hashedValue);
    } catch {
      // bcrypt throws on malformed input; a failing comparison is simply a
      // failing comparison
      return false;
    }
  }

  /**
   * A hash needs rehashing when its cost differs from the configuration or
   * it is not a bcrypt hash at all
   */
  needsRehash(hashedValue: string, options: BcryptOptions = {}): boolean {
    const match = HASH_PATTERN.exec(hashedValue);

    if (!match) {
      return true;
    }

    const rounds = options.rounds ?? this.options.rounds ?? DEFAULT_ROUNDS;

    return Number(match[1]) !== rounds;
  }

  /**
   * Prove the configured cost can verify its own output
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
   * Parse the algorithm version and cost out of a bcrypt hash
   */
  info(hashedValue: string): HashInfo | null {
    const match = HASH_PATTERN.exec(hashedValue);

    if (!match) {
      return null;
    }

    const algo = hashedValue.slice(1, 4);

    return {
      algo: `$${algo}$`,
      options: { rounds: Number(match[1]) },
      // bcrypt stores salt and digest together in base64 crypt form; the
      // 22-character salt prefix is the informative part
      salt: hashedValue.slice(7, 29),
    };
  }

  /**
   * Resolve the optional bcrypt package once, caching the miss so a missing
   * dependency reports itself identically every time
   */
  protected module(): BcryptModule {
    if (this.loaded) {
      return this.loaded;
    }

    if (this.loaded === null) {
      throw new HashDriverUnavailableException('bcrypt', ALGORITHM);
    }

    try {
      // Optional native peer dependency, resolved lazily so orchestr works
      // unchanged while it is not installed
      const loaded = requireOptionalPackage('bcrypt') as BcryptModule;

      if (typeof loaded.hashSync !== 'function' || typeof loaded.compareSync !== 'function') {
        throw new Error('Package does not expose hashSync()/compareSync().');
      }

      this.loaded = loaded;

      return loaded;
    } catch (error) {
      this.loaded = null;

      throw new HashDriverUnavailableException('bcrypt', ALGORITHM, error);
    }
  }
}
