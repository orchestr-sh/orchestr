/**
 * Hasher Contract
 *
 * Defines the interface every password hasher must satisfy: create a hash,
 * verify a candidate, detect stale hashes, and prove the configured options
 * actually work. Mirrors Illuminate\Contracts\Hashing\Hasher; concrete
 * hashers additionally expose driver() to name themselves.
 */
export interface Hasher {
  /**
   * Hash a value, embedding the parameters needed to verify it later
   * Laravel: Hasher::make()
   */
  make(value: string, options?: Record<string, any>): string;

  /**
   * Verify a candidate against a hash in constant time
   * Laravel: Hasher::check()
   */
  check(value: string, hashedValue: string, options?: Record<string, any>): boolean;

  /**
   * Determine whether a hash was created with options that differ from the
   * current configuration and should be rehashed on next login
   * Laravel: Hasher::needsRehash()
   */
  needsRehash(hashedValue: string, options?: Record<string, any>): boolean;

  /**
   * Round-trip a test value through make() + check() and throw when the
   * configured options cannot verify their own output
   * Laravel: Hasher::verifyConfiguration()
   */
  verifyConfiguration(value?: string): void;

  /**
   * Parse the algorithm and options out of a hash, or null when the string
   * was not produced by this driver
   * Laravel: Hasher::info()
   */
  info(hashedValue: string): HashInfo | null;
}

/**
 * The algorithm name, its embedded options and the salt of a hash, as
 * reported by Hasher::info()
 * Laravel: password_get_info()
 */
export interface HashInfo {
  /** Algorithm identifier, e.g. 'scrypt' or '2b' */
  algo: string;

  /** Options carried inside the hash string (cost, rounds, memory, ...) */
  options: Record<string, any>;

  /** The salt embedded in the hash, if the format exposes one */
  salt: string | null;
}
