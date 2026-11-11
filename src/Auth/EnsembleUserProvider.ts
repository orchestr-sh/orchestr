/**
 * EnsembleUserProvider
 *
 * Retrieves users from Ensemble models (the port's EloquentUserProvider).
 * The provider owns user retrieval (SRP): the guard decides *when* users are
 * looked up, this class decides *how*, driven entirely by configuration -
 * the model class plus the credential, password and rehash options - so
 * apps can authenticate any Ensemble model by any column set.
 *
 * Credential lookup mirrors Laravel: every credential key except password
 * columns becomes an `where` clause; when `credentials` is configured the
 * lookup is restricted to exactly those columns. Password verification goes
 * through the shared Hasher contract, rehashing stale hashes on the fly when
 * `rehash` is enabled (Laravel's rehasher callback).
 *
 * @example
 * ```typescript
 * const provider = new EnsembleUserProvider(
 *   { model: User, credentials: ['email'] },
 *   new HashManager({ driver: 'scrypt' })
 * );
 *
 * const user = await provider.retrieveByCredentials({ email: 'ada@example.com', password: 'secret' });
 * await provider.validateCredentials(user!, { email: 'ada@example.com', password: 'secret' }); // true
 * ```
 */

import type { Authenticatable } from '@/Auth/Contracts/Authenticatable';
import type { AuthCredentials, UserProvider } from '@/Auth/Contracts/UserProvider';
import type { Hasher } from '@/Hashing/Contracts/Hasher';

/**
 * The retrieval surface EnsembleUserProvider queries. EnsembleBuilder
 * satisfies it structurally (`where(column, value)` plus `find`/`first`),
 * which keeps the provider usable with any model exposing the same calls.
 */
export interface UserProviderQuery {
  where(column: string, operator?: any, value?: any): UserProviderQuery;
  find(identifier: any): Promise<any>;
  first(): Promise<any>;
}

/**
 * The user instance surface the provider persists remember tokens and
 * rehashes passwords through: Ensemble instances satisfy it once the model
 * also carries the HasAuthenticatable concern.
 */
export interface EnsembleUserInstance extends Authenticatable {
  setAttribute(key: string, value: any): unknown;
  save(): Promise<boolean>;
}

/**
 * The model class shape the provider accepts: a zero-argument-constructible
 * Ensemble subclass exposing the static `query()` builder.
 */
export interface UserProviderModel {
  new (...args: any[]): EnsembleUserInstance;
  query(): UserProviderQuery;
}

/**
 * `auth.providers.*` entries for the ensemble driver
 */
export interface EnsembleUserProviderConfig {
  driver?: string;
  /**
   * The Ensemble (plus HasAuthenticatable) model class users are stored in
   * Laravel: auth.providers.users.model
   */
  model?: UserProviderModel;
  /**
   * Credential columns used for lookups. Defaults to every submitted
   * credential key that is not a password column.
   */
  credentials?: string[];
  /**
   * Name of the password credential/column; also excluded from lookups when
   * the key contains it (Laravel's `str_contains($key, 'password')`)
   */
  password?: string;
  /**
   * Rehash stale hashes on successful verification (default true)
   */
  rehash?: boolean;
  [key: string]: any;
}

export class EnsembleUserProvider implements UserProvider {
  protected readonly model: UserProviderModel;

  protected readonly credentialColumns: string[] | null;

  protected readonly passwordColumn: string;

  protected readonly rehashOnStale: boolean;

  constructor(
    config: EnsembleUserProviderConfig,
    protected readonly hasher: Hasher
  ) {
    if (!config.model) {
      throw new Error(
        'Auth provider [users] has no model configured. Set providers.<name>.model to an Ensemble ' +
          'class extended with the HasAuthenticatable concern.'
      );
    }

    this.model = config.model;
    this.credentialColumns = config.credentials ? [...config.credentials] : null;
    this.passwordColumn = config.password ?? 'password';
    this.rehashOnStale = config.rehash !== false;
  }

  /**
   * Retrieve a user by their unique (primary key) identifier
   * Laravel: EloquentUserProvider::retrieveById()
   */
  async retrieveById(identifier: any): Promise<Authenticatable | null> {
    return (await this.query().find(identifier)) ?? null;
  }

  /**
   * Retrieve a user by identifier and remember-me token; returns null when
   * either side of the recaller no longer matches a stored row
   * Laravel: EloquentUserProvider::retrieveByToken()
   */
  async retrieveByToken(identifier: any, token: string): Promise<Authenticatable | null> {
    const user = this.newUser();
    const tokenColumn = user.getRememberTokenName();

    if (!tokenColumn) {
      return null;
    }

    return (
      (await this.query().where(user.getAuthIdentifierName(), identifier).where(tokenColumn, token).first()) ?? null
    );
  }

  /**
   * Persist a new remember token on the user. Timestamps stay untouched -
   * like Laravel, the remember-token write does not touch `updated_at`.
   * Laravel: EloquentUserProvider::updateRememberToken()
   */
  async updateRememberToken(user: Authenticatable, token: string | null): Promise<void> {
    const instance = this.requireInstance(user);

    instance.setRememberToken(token);

    const model = instance as unknown as { timestamps?: boolean };
    const timestamps = model.timestamps;
    model.timestamps = false;

    try {
      await instance.save();
    } finally {
      model.timestamps = timestamps;
    }
  }

  /**
   * Look up the user matching the credential columns, ignoring passwords
   * Laravel: EloquentUserProvider::retrieveByCredentials()
   */
  async retrieveByCredentials(credentials: AuthCredentials): Promise<Authenticatable | null> {
    const query = this.query();
    let hasLookup = false;

    for (const [key, value] of Object.entries(credentials)) {
      if (!this.isLookupColumn(key)) {
        continue;
      }

      query.where(key, value);
      hasLookup = true;
    }

    // Credentials carrying no lookup column (password only) must never
    // collapse into "first row in the table"
    if (!hasLookup) {
      return null;
    }

    return (await query.first()) ?? null;
  }

  /**
   * Verify the plaintext password against the user's stored hash, rehashing
   * the stored value when it was produced with stale options
   * Laravel: EloquentUserProvider::validateCredentials() (with rehasher)
   */
  async validateCredentials(user: Authenticatable, credentials: AuthCredentials): Promise<boolean> {
    const plain = this.plainPasswordFrom(credentials);
    const stored = user.getAuthPassword();

    if (plain === null || stored === null || !this.hasher.check(plain, stored)) {
      return false;
    }

    if (this.rehashOnStale && this.hasher.needsRehash(stored)) {
      const instance = this.requireInstance(user);

      instance.setAttribute(instance.getAuthPasswordName(), this.hasher.make(plain));
      await instance.save();
    }

    return true;
  }

  /**
   * The hashing manager backing credential verification
   */
  getHasher(): Hasher {
    return this.hasher;
  }

  /**
   * Fresh model instance used to read column conventions (key/remember names)
   */
  protected newUser(): EnsembleUserInstance {
    return new this.model();
  }

  /**
   * A new query against the configured model
   */
  protected query(): UserProviderQuery {
    return this.model.query();
  }

  /**
   * Whether a credential key participates in the user lookup: not a password
   * (Laravel skips keys containing 'password'), and within the configured
   * credential columns when those were declared.
   */
  protected isLookupColumn(key: string): boolean {
    if (key === this.passwordColumn || key.includes('password')) {
      return false;
    }

    return this.credentialColumns === null || this.credentialColumns.includes(key);
  }

  /**
   * The plaintext password inside submitted credentials, honouring the
   * configured password column name
   */
  protected plainPasswordFrom(credentials: AuthCredentials): string | null {
    const plain = credentials[this.passwordColumn] ?? credentials.password;

    if (plain === undefined || plain === null) {
      return null;
    }

    return String(plain);
  }

  /**
   * Guard that a provider-retrieved user really is the Ensemble-shaped
   * instance this provider hands out
   */
  protected requireInstance(user: Authenticatable): EnsembleUserInstance {
    const instance = user as Partial<EnsembleUserInstance>;

    if (typeof instance.setAttribute !== 'function' || typeof instance.save !== 'function') {
      throw new Error(
        'Authenticatable users must be Ensemble model instances (or expose setAttribute/save) to be ' +
          'used with the ensemble user provider.'
      );
    }

    return instance as EnsembleUserInstance;
  }
}
