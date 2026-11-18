/**
 * PasswordBrokerManager - builds brokers from `auth.passwords` config
 *
 * The manager pattern the Auth/Cache/Hash modules already apply (SRP):
 * configuration lives here, `auth.defaults.passwords` selects the default
 * broker, and every broker wires its own user provider (through the
 * AuthManager) plus a token repository from the broker's `driver`. Custom
 * repository drivers register through extend() without touching this class
 * (OCP). The Password facade and password() helper talk to this manager;
 * its forwarding methods reach the default broker, like Laravel's
 * `__call()` hop from `Password::sendResetLink()` to the broker instance.
 *
 * Mirrors Illuminate\Auth\Passwords\PasswordBrokerManager.
 */

import type { AuthConfig, AuthPasswordBrokerConfig, AuthManager } from '@/Auth/AuthManager';
import type { AuthCredentials } from '@/Auth/Contracts/UserProvider';
import type { PasswordResetTokenRepository } from './Contracts/PasswordResetTokenRepository';
import type { PasswordResetTokenQuery } from './DatabaseTokenRepository';
import type { DatabaseTokenRepositoryConfig } from './DatabaseTokenRepository';
import type { ResetCallback } from './PasswordBroker';
import { DatabaseTokenRepository } from './DatabaseTokenRepository';
import { PasswordBroker } from './PasswordBroker';

/**
 * The database seam: `db.connection(name).table(name)` shaped. The
 * DatabaseManager satisfies it; the manager resolves it lazily so
 * registration order never matters.
 */
export interface PasswordResetDatabase {
  connection(name?: string): { table(name: string): PasswordResetTokenQuery };
}

/**
 * A custom token-repository driver factory: builds the repository for one
 * `auth.passwords` entry. Receives the manager so factories can resolve
 * collaborators (OCP for broker drivers).
 */
export type TokenRepositoryFactory = (
  name: string,
  config: AuthPasswordBrokerConfig,
  manager: PasswordBrokerManager
) => PasswordResetTokenRepository;

/**
 * Collaborators the manager needs: the auth manager (providers, the hasher
 * and the merged `auth.*` configuration), the application key supplier
 * (token hashing) and the database seam. All resolved lazily.
 */
export interface PasswordBrokerDependencies {
  auth: () => AuthManager;
  appKey?: () => string | Buffer | null | undefined;
  database?: () => PasswordResetDatabase | null;
}

export class PasswordBrokerManager {
  /**
   * Brokers built so far, cached per name
   */
  protected brokers: Map<string, PasswordBroker> = new Map();

  /**
   * Custom token-repository drivers registered through extend()
   */
  protected customDrivers: Map<string, TokenRepositoryFactory> = new Map();

  constructor(protected readonly dependencies: PasswordBrokerDependencies) {}

  /**
   * The merged `auth.*` configuration, read off the AuthManager so the
   * defaults are merged in exactly one place (DRY).
   */
  authConfig(): AuthConfig {
    return this.dependencies.auth().config;
  }

  /**
   * Register a custom token repository driver under a name
   * Laravel: PasswordBrokerManager::extend() (via the provider's creator)
   */
  extend(driver: string, factory: TokenRepositoryFactory): this {
    this.customDrivers.set(driver, factory);
    this.brokers.clear();

    return this;
  }

  /**
   * The broker for a `auth.passwords` entry, defaulting to
   * `auth.defaults.passwords` ('users' when unset).
   * Laravel: PasswordBrokerManager::broker()
   */
  broker(name?: string): PasswordBroker {
    const brokerName = name ?? this.authConfig().defaults.passwords ?? 'users';

    const existing = this.brokers.get(brokerName);

    if (existing) {
      return existing;
    }

    const broker = new PasswordBroker(
      this.usersProvider(brokerName),
      this.createTokenRepository(brokerName),
      this.dependencies.auth().hasher()
    );

    this.brokers.set(brokerName, broker);

    return broker;
  }

  /**
   * Forget every built broker (configuration changed, tests)
   */
  forgetBrokers(): this {
    this.brokers.clear();

    return this;
  }

  // ---------------------------------------------------------------------
  // Default-broker forwarding, like Laravel's PasswordBrokerManager::__call()
  // ---------------------------------------------------------------------

  /**
   * Send a reset link through the default broker.
   * Laravel: Password::sendResetLink($credentials)
   */
  sendResetLink(credentials: AuthCredentials): Promise<string> {
    return this.broker().sendResetLink(credentials);
  }

  /**
   * Reset a password through the default broker.
   * Laravel: Password::reset($credentials, $callback)
   */
  reset(credentials: AuthCredentials, callback?: ResetCallback): Promise<string> {
    return this.broker().reset(credentials, callback);
  }

  /**
   * Validate a reset token through the default broker.
   * Laravel: Password::validateToken($credentials)
   */
  validateToken(credentials: AuthCredentials): Promise<true | string> {
    return this.broker().validateToken(credentials);
  }

  /**
   * Delete a user's stored token through the default broker.
   * Laravel: Password::deleteToken($user)
   */
  deleteToken(credentials: AuthCredentials): Promise<void> {
    return this.broker().deleteToken(credentials);
  }

  /**
   * The user provider a broker retrieves resettable users with: the entry's
   * `provider` key, defaulting to 'users'.
   */
  protected usersProvider(brokerName: string) {
    const entry = this.passwordConfig(brokerName);

    return this.dependencies.auth().provider(entry.provider ?? 'users');
  }

  /**
   * One `auth.passwords` entry, with a helpful error when missing.
   */
  protected passwordConfig(brokerName: string): AuthPasswordBrokerConfig {
    const section = this.authConfig().passwords ?? {};
    const entry = section[brokerName];

    if (!entry) {
      throw new Error(
        `Password broker [${brokerName}] is not defined. Available brokers: ` +
          `${Object.keys(section).join(', ') || 'none'}. Configure auth.passwords.${brokerName}.`
      );
    }

    return entry;
  }

  /**
   * Build the token repository for one broker: custom drivers first, the
   * built-in 'database' driver otherwise.
   * Laravel: PasswordBrokerManager::createTokenRepository()
   */
  protected createTokenRepository(brokerName: string): PasswordResetTokenRepository {
    const entry = this.passwordConfig(brokerName);
    const driver = entry.driver ?? 'database';

    const custom = this.customDrivers.get(driver);

    if (custom) {
      return custom(brokerName, entry, this);
    }

    if (driver !== 'database') {
      throw new Error(
        `Password broker driver [${driver}] is not defined. Built-in drivers: database` +
          (this.customDrivers.size > 0 ? `, ${Array.from(this.customDrivers.keys()).join(', ')}` : '') +
          '. Register custom drivers with Password.extend().'
      );
    }

    const repositoryConfig: DatabaseTokenRepositoryConfig = {
      expire: (entry.expire ?? 60) * 60,
      throttle: entry.throttle ?? 60,
      hashKey: () => this.resolveAppKey(),
      resolveTable: () => this.resolveTable(brokerName),
    };

    return new DatabaseTokenRepository(repositoryConfig);
  }

  /**
   * The configured table reached through the database seam.
   */
  protected resolveTable(brokerName: string): PasswordResetTokenQuery {
    const entry = this.passwordConfig(brokerName);
    const database = this.dependencies.database?.();

    if (!database) {
      throw new Error(
        'Password resets need a database connection for the token table. Register the ' +
          'DatabaseServiceProvider first (or a custom broker driver through Password.extend()).'
      );
    }

    return database.connection(entry.connection).table(entry.table ?? 'password_reset_tokens');
  }

  /**
   * The application key the token hash is computed with.
   */
  protected resolveAppKey(): string | Buffer | null | undefined {
    return this.dependencies.appKey?.() ?? null;
  }
}
