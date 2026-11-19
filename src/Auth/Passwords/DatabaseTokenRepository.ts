/**
 * DatabaseTokenRepository - reset tokens in the `password_reset_tokens` table
 *
 * The Laravel counterpart (`Illuminate\Auth\Passwords\
 * DatabaseTokenRepository`): tokens are stored as keyed hashes (never in
 * plain text), expire after the configured window, and carry a creation
 * throttle so the same address cannot collect a fresh link every click.
 * The plain-text token only ever leaves this class inside the record
 * `create()` returns, so the broker can mail it without the table ever
 * seeing it (SRP: the repository owns token storage, the broker owns the
 * flow).
 *
 * The table is reached through a structural query seam - the database
 * layer's query builder satisfies it - so the repository runs against any
 * connection (and any test double) without importing the Database module.
 *
 * @example
 * ```typescript
 * const repository = new DatabaseTokenRepository({
 *   resolveTable: () => db.connection().table('password_reset_tokens'),
 *   expire: 60 * 60,
 *   throttle: 60,
 *   hashKey: () => config('app.key'),
 * });
 *
 * const record = await repository.create(user); // { email, token: hashed, created_at, plainTextToken }
 * await repository.exists(user, record.plainTextToken); // true
 * ```
 */

import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import type { CanResetPassword } from '@/Auth/Contracts/CanResetPassword';
import { MissingAppKeyException } from '@/Encryption/MissingAppKeyException';
import { requireAppKey } from '@/Support/AppKey';
import type {
  CreatedPasswordResetToken,
  PasswordResetTokenRecord,
  PasswordResetTokenRepository,
} from './Contracts/PasswordResetTokenRepository';

/**
 * The fluent subset of the query builder this repository issues:
 * `where(...)` chaining, `first()`, `insert()` and `delete()`. The
 * Connection's table builder satisfies it; test doubles can fake it.
 */
export interface PasswordResetTokenQuery {
  where(column: string, operator?: any, value?: any): PasswordResetTokenQuery;
  first(): Promise<Record<string, any> | null>;
  insert(values: Record<string, any>): Promise<unknown>;
  delete(): Promise<unknown>;
}

/**
 * Where the token table comes from: `db.connection(name).table(name)`
 * shaped, so the repository resolves the running application's database
 * lazily (registration order never matters, the manager pattern again).
 */
export type PasswordResetTableResolver = () => PasswordResetTokenQuery;

export interface DatabaseTokenRepositoryConfig {
  /**
   * Seconds a token stays valid (Laravel: `expire` config times 60)
   */
  expire?: number;

  /**
   * Seconds between two freshly created tokens for the same address
   * (Laravel: `throttle` config)
   */
  throttle?: number;

  /**
   * The application key the token hash is keyed with. Resolved lazily so
   * late-bound configuration still works.
   */
  hashKey: () => string | Buffer | null | undefined;

  /**
   * The table holding the tokens, resolved per operation
   */
  resolveTable: PasswordResetTableResolver;
}

export class DatabaseTokenRepository implements PasswordResetTokenRepository {
  /**
   * Laravel: DatabaseTokenRepository::$expire (seconds)
   */
  protected readonly expire: number;

  /**
   * Laravel: DatabaseTokenRepository::DEFAULT_THROTTLE
   */
  protected readonly throttle: number;

  constructor(protected readonly config: DatabaseTokenRepositoryConfig) {
    this.expire = config.expire ?? 60 * 60;
    this.throttle = config.throttle ?? 60;
  }

  /**
   * Generate a fresh token and store it for the user. The stored row keeps
   * the hash; the returned record carries the plain-text token for mailing.
   * Laravel: DatabaseTokenRepository::create()
   */
  async create(user: CanResetPassword): Promise<CreatedPasswordResetToken> {
    const email = user.getEmailForPasswordReset();
    const plainTextToken = this.newToken();
    const createdAt = this.now();

    const record: PasswordResetTokenRecord = {
      email,
      token: this.hashToken(plainTextToken),
      created_at: createdAt,
    };

    const query = this.table();

    // Laravel deletes the address's previous row first: one live token per
    // address, and a fresh reset request always resets the expiry window.
    await query.where('email', '=', email).delete();
    await query
      .where('email', '=', email)
      .insert({ email: record.email, token: record.token, created_at: record.created_at });

    return { ...record, plainTextToken };
  }

  /**
   * Determine whether the raw token matches the stored hash for the user's
   * address and has not passed its expiry window.
   * Laravel: DatabaseTokenRepository::exists()
   */
  async exists(user: CanResetPassword, token: string): Promise<boolean> {
    const record = await this.forEmail(user.getEmailForPasswordReset());

    if (!record || typeof record.token !== 'string' || token === '') {
      return false;
    }

    return this.verifyToken(token, record.token) && Number(record.created_at) > this.now() - this.expire;
  }

  /**
   * Remove every stored token for the user's address.
   * Laravel: DatabaseTokenRepository::delete()
   */
  async delete(user: CanResetPassword): Promise<void> {
    await this.table().where('email', '=', user.getEmailForPasswordReset()).delete();
  }

  /**
   * Whether a token was created for the address inside the throttle window.
   * Laravel: DatabaseTokenRepository::recentlyCreatedToken()
   */
  async recentlyCreatedToken(user: CanResetPassword): Promise<boolean> {
    const record = await this.forEmail(user.getEmailForPasswordReset());

    if (!record) {
      return false;
    }

    return Number(record.created_at) > this.now() - this.throttle;
  }

  /**
   * The plain-text token: 40 URL-safe random characters, like Laravel's
   * `Str::random(40)`-sourced tokens.
   */
  protected newToken(): string {
    return randomBytes(30).toString('base64url');
  }

  /**
   * HMAC-SHA256 the token with the application key so a leaked table never
   * yields usable tokens.
   * Laravel: DatabaseTokenRepository::hash()
   */
  protected hashToken(token: string): string {
    let key: string | Buffer | null | undefined;

    try {
      key = requireAppKey(this.config.hashKey());
    } catch (error) {
      if (error instanceof MissingAppKeyException) {
        throw new Error(
          'Password reset tokens need the application key to be hashed. Set app.key (or APP_KEY) so ' +
            'the password broker can store hashed tokens.'
        );
      }

      throw error;
    }

    return createHmac('sha256', key).update(token).digest('hex');
  }

  /**
   * Constant-time comparison of the hashed presentation against the stored
   * hash. Laravel: hash_equals()
   */
  protected verifyToken(presented: string, storedHash: string): boolean {
    const computed = Buffer.from(this.hashToken(presented));
    const stored = Buffer.from(storedHash);

    return computed.length === stored.length && timingSafeEqual(computed, stored);
  }

  /**
   * The stored row for an address, or null when none exists.
   */
  protected async forEmail(email: string): Promise<Record<string, any> | null> {
    return (await this.table().where('email', '=', email).first()) ?? null;
  }

  protected table(): PasswordResetTokenQuery {
    return this.config.resolveTable();
  }

  /**
   * Whole seconds since the epoch; Laravel's time().
   */
  protected now(): number {
    return Math.floor(Date.now() / 1000);
  }
}
