/**
 * ScryptHasher
 *
 * The default Orchestr hasher, built entirely on `node:crypto` so password
 * hashing works without any optional dependency. Hash strings use a
 * PHC-style format that embeds every parameter needed to re-derive the
 * digest, which keeps `check()` correct for old hashes even after the
 * configuration changes and lets `needsRehash()` spot the difference:
 *
 *   `$scrypt$N=<cost>,r=<blockSize>,p=<parallelization>$<salt>$<digest>`
 *
 * with the salt and digest base64 encoded.
 *
 * Laravel: Illuminate\Hashing\BcryptHasher holds the equivalent role; this
 * port defaults to scrypt because it needs no native addon.
 *
 * @example
 * ```typescript
 * const hasher = new ScryptHasher({ cost: 16384, blockSize: 8, parallelization: 1 });
 * const hash = hasher.make('secret');
 * hasher.check('secret', hash); // true
 * ```
 */

import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

export interface ScryptOptions {
  /** CPU/memory cost parameter (N); must be a power of two greater than 1 */
  cost?: number;
  /** Block size (r) */
  blockSize?: number;
  /** Parallelization factor (p) */
  parallelization?: number;
  /** Length of the derived key in bytes */
  keyLength?: number;
  /** Length of the generated salt in bytes */
  saltLength?: number;
}

/** Defaults matching node:crypto's documented scrypt recommendations */
const DEFAULTS: Required<Omit<ScryptOptions, 'saltLength'>> & { saltLength: number } = {
  cost: 16384,
  blockSize: 8,
  parallelization: 1,
  keyLength: 64,
  saltLength: 16,
};

const ALGORITHM = 'scrypt';
const PREFIX = `$${ALGORITHM}$`;
const PARAM_PATTERN = /^N=(\d+),r=(\d+),p=(\d+)$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

export class ScryptHasher {
  constructor(protected options: ScryptOptions = {}) {}

  /**
   * The name of this hasher's driver
   */
  driver(): string {
    return ALGORITHM;
  }

  /**
   * Derive a scrypt hash with the configured (or per-call) parameters
   */
  make(value: string, options: ScryptOptions = {}): string {
    const params = this.merge(options);

    this.validate(params);

    const salt = randomBytes(params.saltLength);
    const digest = this.derive(value, salt, params);

    return `${PREFIX}N=${params.cost},r=${params.blockSize},p=${params.parallelization}$${salt.toString('base64')}$${digest.toString('base64')}`;
  }

  /**
   * Re-derive the digest with the parameters and salt embedded in the hash
   * and compare in constant time
   */
  check(value: string, hashedValue: string, options: ScryptOptions = {}): boolean {
    const parsed = this.parse(hashedValue);

    if (!parsed) {
      return false;
    }

    let digest: Buffer;

    try {
      digest = this.derive(value, parsed.salt, { ...this.merge(options), ...parsed.options });
    } catch {
      // A hash carrying hostile parameters (absurd cost, say) simply fails
      return false;
    }

    return timingSafeCompare(digest, parsed.digest);
  }

  /**
   * A hash needs rehashing when it cannot be parsed at all or was created
   * with parameters that differ from the current configuration
   */
  needsRehash(hashedValue: string, options: ScryptOptions = {}): boolean {
    const parsed = this.parse(hashedValue);

    if (!parsed) {
      return true;
    }

    const current = this.merge(options);

    return (
      parsed.options.cost !== current.cost ||
      parsed.options.blockSize !== current.blockSize ||
      parsed.options.parallelization !== current.parallelization ||
      parsed.options.keyLength !== current.keyLength
    );
  }

  /**
   * Prove the configured options can verify their own output
   */
  verifyConfiguration(value: string = 'password'): void {
    let hash: string;

    try {
      hash = this.make(value);
    } catch (error) {
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
   * Parse the algorithm, options and salt out of a hash
   */
  info(hashedValue: string): { algo: string; options: Record<string, any>; salt: string | null } | null {
    const parsed = this.parse(hashedValue);

    if (!parsed) {
      return null;
    }

    return {
      algo: ALGORITHM,
      options: { ...parsed.options },
      salt: parsed.salt.toString('base64'),
    };
  }

  /**
   * Merge call options over the hasher's configured options over defaults
   */
  protected merge(options: ScryptOptions): typeof DEFAULTS {
    return {
      cost: options.cost ?? this.options.cost ?? DEFAULTS.cost,
      blockSize: options.blockSize ?? this.options.blockSize ?? DEFAULTS.blockSize,
      parallelization: options.parallelization ?? this.options.parallelization ?? DEFAULTS.parallelization,
      keyLength: options.keyLength ?? this.options.keyLength ?? DEFAULTS.keyLength,
      saltLength: options.saltLength ?? this.options.saltLength ?? DEFAULTS.saltLength,
    };
  }

  /**
   * Reject parameter sets scrypt cannot use, so misconfiguration fails at
   * Hash.make() time with a clear message instead of inside node:crypto
   */
  protected validate(params: typeof DEFAULTS): void {
    if (!Number.isInteger(params.cost) || params.cost <= 1 || (params.cost & (params.cost - 1)) !== 0) {
      throw new Error(`Invalid scrypt cost [${params.cost}]: must be an integer power of two greater than 1.`);
    }

    if (!Number.isInteger(params.blockSize) || params.blockSize < 1) {
      throw new Error(`Invalid scrypt blockSize [${params.blockSize}]: must be an integer of at least 1.`);
    }

    if (!Number.isInteger(params.parallelization) || params.parallelization < 1) {
      throw new Error(`Invalid scrypt parallelization [${params.parallelization}]: must be an integer of at least 1.`);
    }

    if (!Number.isInteger(params.keyLength) || params.keyLength < 1) {
      throw new Error(`Invalid scrypt keyLength [${params.keyLength}]: must be an integer of at least 1.`);
    }

    if (!Number.isInteger(params.saltLength) || params.saltLength < 1) {
      throw new Error(`Invalid scrypt saltLength [${params.saltLength}]: must be an integer of at least 1.`);
    }
  }

  /**
   * Run scrypt with enough maxmem headroom for large cost factors
   */
  protected derive(value: string, salt: Buffer, params: typeof DEFAULTS): Buffer {
    return scryptSync(Buffer.from(value, 'utf8'), salt, params.keyLength, {
      N: params.cost,
      r: params.blockSize,
      p: params.parallelization,
      maxmem: Math.max(32 * 1024 * 1024, 256 * params.cost * params.blockSize * params.parallelization),
    });
  }

  /**
   * Split a hash into its parameters, salt and digest
   */
  private parse(hashedValue: string): { options: Partial<ScryptOptions>; salt: Buffer; digest: Buffer } | null {
    if (typeof hashedValue !== 'string' || !hashedValue.startsWith(PREFIX)) {
      return null;
    }

    const [params, salt, digest, extra] = hashedValue.slice(PREFIX.length).split('$');

    if (extra !== undefined || !params || !salt || !digest) {
      return null;
    }

    const match = PARAM_PATTERN.exec(params);

    if (!match || !BASE64_PATTERN.test(salt) || !BASE64_PATTERN.test(digest)) {
      return null;
    }

    const saltBytes = Buffer.from(salt, 'base64');
    const digestBytes = Buffer.from(digest, 'base64');

    if (saltBytes.length === 0 || digestBytes.length === 0) {
      return null;
    }

    return {
      options: {
        cost: Number(match[1]),
        blockSize: Number(match[2]),
        parallelization: Number(match[3]),
        keyLength: digestBytes.length,
      },
      salt: saltBytes,
      digest: digestBytes,
    };
  }
}

/**
 * Constant-time buffer comparison (hash_equals()); length mismatches can
 * only be detected by length, never by content
 */
function timingSafeCompare(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) {
    return false;
  }

  return timingSafeEqual(a, b);
}
