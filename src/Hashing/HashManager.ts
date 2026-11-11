/**
 * HashManager
 *
 * Resolves password hashers by driver name and forwards the Hasher contract
 * to the default driver, mirroring Laravel's Illuminate\Hashing\HashManager.
 * Built-in drivers: `scrypt` (default, pure node:crypto), `bcrypt` and
 * `argon2` (each behind an optional peer dependency), and `extend()` adds
 * custom drivers without touching this class (OCP).
 *
 * @example
 * ```typescript
 * const manager = new HashManager({ driver: 'scrypt', scrypt: { cost: 16384 } });
 *
 * const hash = manager.make('secret');          // default driver
 * manager.check('secret', hash);               // true
 * manager.driver('bcrypt').make('secret');     // requires the bcrypt package
 * ```
 */

import type { Hasher } from './Contracts/Hasher';
import { ArgonHasher, type Argon2Options } from './ArgonHasher';
import { BcryptHasher, type BcryptOptions } from './BcryptHasher';
import { ScryptHasher, type ScryptOptions } from './ScryptHasher';

/**
 * Per-driver hashing configuration, one key per driver
 */
export interface HashingConfig {
  /** Default driver name */
  driver: string;
  /** scrypt (node:crypto) options */
  scrypt: ScryptOptions;
  /** bcrypt options */
  bcrypt: BcryptOptions;
  /** argon2 options */
  argon2: Argon2Options;
}

/**
 * A hashing driver factory: builds the hasher from its configuration section
 */
export type HasherFactory = (config: HashingConfig) => Hasher;

/**
 * Default configuration merged under whatever the app provides
 */
export const HASHING_DEFAULTS: HashingConfig = {
  driver: 'scrypt',
  scrypt: {},
  bcrypt: {},
  argon2: {},
};

export class HashManager implements Hasher {
  public readonly config: HashingConfig;

  protected drivers: Map<string, Hasher> = new Map();

  protected customDrivers: Map<string, HasherFactory> = new Map();

  constructor(config: Partial<HashingConfig> = {}) {
    this.config = {
      ...HASHING_DEFAULTS,
      ...config,
      scrypt: { ...HASHING_DEFAULTS.scrypt, ...(config.scrypt ?? {}) },
      bcrypt: { ...HASHING_DEFAULTS.bcrypt, ...(config.bcrypt ?? {}) },
      argon2: { ...HASHING_DEFAULTS.argon2, ...(config.argon2 ?? {}) },
    };
  }

  /**
   * Register a custom hashing driver
   * Laravel: Hash::extend()
   */
  extend(name: string, factory: HasherFactory): this {
    this.customDrivers.set(name, factory);
    this.drivers.delete(name);

    return this;
  }

  /**
   * The default driver name
   * Laravel: HashManager::getDefaultDriver()
   */
  getDefaultDriver(): string {
    return this.config.driver;
  }

  /**
   * Resolve a hasher by driver name, defaulting to the configured driver
   * Laravel: HashManager::driver()
   */
  driver(name?: string): Hasher {
    const driverName = name ?? this.config.driver;

    const cached = this.drivers.get(driverName);

    if (cached) {
      return cached;
    }

    const hasher = this.createDriver(driverName);
    this.drivers.set(driverName, hasher);

    return hasher;
  }

  /**
   * Hash a value with the default driver
   */
  make(value: string, options: Record<string, any> = {}): string {
    return this.driver().make(value, options);
  }

  /**
   * Verify a candidate against a hash with the default driver
   */
  check(value: string, hashedValue: string, options: Record<string, any> = {}): boolean {
    return this.driver().check(value, hashedValue, options);
  }

  /**
   * Determine whether a hash was created with stale options
   */
  needsRehash(hashedValue: string, options: Record<string, any> = {}): boolean {
    return this.driver().needsRehash(hashedValue, options);
  }

  /**
   * Verify the default driver's configuration round-trips
   */
  verifyConfiguration(value?: string): void {
    this.driver().verifyConfiguration(value);
  }

  /**
   * Algorithm information embedded in a hash
   */
  info(hashedValue: string) {
    return this.driver().info(hashedValue);
  }

  /**
   * Build a driver instance: custom factories first, then the built-in
   * scrypt/bcrypt/argon2 trio
   */
  protected createDriver(name: string): Hasher {
    const custom = this.customDrivers.get(name);

    if (custom) {
      return custom(this.config);
    }

    switch (name) {
      case 'scrypt':
        return new ScryptHasher(this.config.scrypt);
      case 'bcrypt':
        return new BcryptHasher(this.config.bcrypt);
      case 'argon2':
        return new ArgonHasher(this.config.argon2);
      default:
        throw new Error(
          `Hash driver [${name}] is not defined. Available drivers: scrypt, bcrypt, argon2` +
            (this.customDrivers.size > 0 ? `, ${Array.from(this.customDrivers.keys()).join(', ')}` : '') +
            '.'
        );
    }
  }
}
