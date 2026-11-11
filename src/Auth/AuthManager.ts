/**
 * AuthManager
 *
 * Builds guards and user providers from `auth.*` configuration and forwards
 * the default guard's API (attempt/login/user/...), following the manager
 * pattern established by CacheManager and HashManager: built-in session and
 * token drivers are known to the manager, and extend() registers custom
 * guards without touching this class (OCP).
 *
 * Mirrors Illuminate\Auth\AuthManager. The manager owns configuration,
 * guards own authentication and providers own retrieval (SRP); the two
 * guards share the same UserProvider contract (DRY).
 *
 * Guards are long-lived per name for CLI/testing use. HTTP applications
 * call forRequest(request, response) at the start of each request (the
 * `auth` middleware does it automatically), which hands that request its
 * own guard instances so no authentication state leaks between requests.
 *
 * @example
 * ```typescript
 * const manager = new AuthManager({
 *   defaults: { guard: 'session' },
 *   guards: {
 *     session: { driver: 'session', provider: 'users' },
 *     token: { driver: 'token', provider: 'users', hash: true },
 *   },
 *   providers: { users: { driver: 'ensemble', model: User, credentials: ['email'] } },
 * }, { session: () => sessionManager.current() });
 *
 * await manager.attempt({ email: 'ada@example.com', password: 'secret' });
 * ```
 */

import type { Authenticatable } from '@/Auth/Contracts/Authenticatable';
import type { StatefulGuard } from '@/Auth/Contracts/Guard';
import type { AuthCredentials, UserProvider } from '@/Auth/Contracts/UserProvider';
import type { EnsembleUserProviderConfig } from '@/Auth/EnsembleUserProvider';
import type { TokenGuardConfig } from '@/Auth/TokenGuard';
import type { Hasher } from '@/Hashing/Contracts/Hasher';
import type { Request } from '@/Routing/Request';
import type { Response } from '@/Routing/Response';
import type { Store } from '@/Session/Contracts/Store';
import { HashManager } from '@/Hashing/HashManager';
import { EnsembleUserProvider } from './EnsembleUserProvider';
import { SessionGuard } from './SessionGuard';
import { TokenGuard } from './TokenGuard';

/**
 * One `auth.guards.*` entry; driver-specific keys (provider, input, token,
 * hash, ...) are interpreted by the driver that builds the guard
 */
export interface AuthGuardConfig {
  driver: string;
  provider?: string;
  [key: string]: any;
}

/**
 * `auth.defaults` — the guard every Auth::/auth() call lands on, plus the
 * password-broker defaults the later reset ticket reads
 */
export interface AuthDefaultsConfig {
  guard: string;
  passwords?: string;
}

/**
 * One `auth.passwords.*` broker entry; stored for the password-reset ticket
 */
export interface AuthPasswordBrokerConfig {
  provider?: string;
  table?: string;
  expire?: number;
  throttle?: number;
}

/**
 * The full authentication configuration, one key per Laravel config/auth.php
 * section
 */
export interface AuthConfig {
  defaults: AuthDefaultsConfig;
  guards: Record<string, AuthGuardConfig>;
  providers: Record<string, EnsembleUserProviderConfig>;
  passwords?: Record<string, AuthPasswordBrokerConfig>;
}

/**
 * A custom guard factory: builds the guard for one `auth.guards` entry.
 * Receives the manager so factories can resolve their provider through
 * manager.provider() (OCP for guard drivers).
 * Laravel: Auth::extend() callback
 */
export type GuardFactory = (name: string, config: AuthGuardConfig, manager: AuthManager) => StatefulGuard;

/**
 * Collaborators the manager needs to build guards: the current request's
 * session store and the password hasher. Both resolve lazily so a long-lived
 * manager always sees the running request's session (and apps may register
 * HashServiceProvider whenever they like).
 */
export interface AuthManagerDependencies {
  /**
   * Resolves the session store for the running request (null before the
   * session middleware ran)
   */
  session?: () => Store | null;
  /**
   * Resolves the hasher used for credential validation; defaults to a
   * HashManager with the standard configuration
   */
  hash?: () => Hasher;
}

/**
 * Default configuration merged under whatever the app provides: the
 * Laravel-shaped session/token guards plus an `users` ensemble provider.
 */
export const AUTH_DEFAULTS: AuthConfig = {
  defaults: { guard: 'session' },
  guards: {
    session: { driver: 'session', provider: 'users' },
    token: { driver: 'token', provider: 'users', hash: false },
  },
  providers: {
    users: { driver: 'ensemble' },
  },
  passwords: {},
};

export class AuthManager {
  public readonly config: AuthConfig;

  /**
   * Guards built outside any request scope, cached per name
   */
  protected guards: Map<string, StatefulGuard> = new Map();

  /**
   * Resolved providers, cached per name
   */
  protected resolvedProviders: Map<string, UserProvider> = new Map();

  /**
   * Custom guard drivers registered through extend()
   */
  protected customExtensions: Map<string, GuardFactory> = new Map();

  /**
   * The request the running guard set was built for; a fresh scope is
   * started by forRequest()
   */
  protected scope: { request: Request; response?: Response; guards: Map<string, StatefulGuard> } | null = null;

  constructor(
    config: Partial<AuthConfig> = {},
    protected readonly dependencies: AuthManagerDependencies = {}
  ) {
    this.config = {
      defaults: { ...AUTH_DEFAULTS.defaults, ...(config.defaults ?? {}) },
      guards: this.mergeSection(AUTH_DEFAULTS.guards, config.guards),
      providers: this.mergeSection(AUTH_DEFAULTS.providers, config.providers),
      passwords: { ...AUTH_DEFAULTS.passwords, ...(config.passwords ?? {}) },
    };
  }

  /**
   * Register a custom guard driver
   * Laravel: AuthManager::extend()
   */
  extend(name: string, factory: GuardFactory): this {
    this.customExtensions.set(name, factory);
    return this;
  }

  /**
   * The default guard name from auth.defaults.guard
   * Laravel: AuthManager::getDefaultDriver()
   */
  getDefaultDriver(): string {
    return this.config.defaults.guard;
  }

  /**
   * Resolve a guard by name, defaulting to auth.defaults.guard. Guards
   * created within a request scope (forRequest) are cached in that scope
   * only; without one they persist on the manager.
   * Laravel: AuthManager::guard()
   */
  guard(name?: string): StatefulGuard {
    const guardName = name ?? this.getDefaultDriver();

    if (!guardName) {
      throw new Error('No authentication guard configured. Set auth.defaults.guard.');
    }

    const cache = this.scope ? this.scope.guards : this.guards;

    const existing = cache.get(guardName);

    if (existing) {
      return existing;
    }

    const guard = this.createGuard(guardName);

    cache.set(guardName, guard);

    return guard;
  }

  /**
   * Resolve the provider (user retrieval) configured for a guard or by name
   * Laravel: AuthManager::createEloquentProvider()
   */
  provider(name?: string): UserProvider {
    const providerName = name ?? 'users';

    const existing = this.resolvedProviders.get(providerName);

    if (existing) {
      return existing;
    }

    const config = this.config.providers[providerName];

    if (!config) {
      throw new Error(
        `Auth provider [${providerName}] is not defined. Available providers: ` +
          `${Object.keys(this.config.providers).join(', ')}.`
      );
    }

    const driver = config.driver ?? 'ensemble';

    if (driver !== 'ensemble') {
      throw new Error(
        `Auth provider driver [${driver}] is not defined. Built-in drivers: ensemble. ` +
          'Custom providers are supplied through guard factories registered with Auth.extend().'
      );
    }

    const provider = new EnsembleUserProvider(config, this.hasher());

    this.resolvedProviders.set(providerName, provider);

    return provider;
  }

  /**
   * The hasher credential validation runs through
   */
  hasher(): Hasher {
    return this.dependencies.hash?.() ?? new HashManager();
  }

  /**
   * Bind the guards to the running request: starts a fresh guard scope so
   * per-request state (memoised users, the session behind the session
   * guard) never leaks into the next request, and points the request's
   * user()/auth() convenience at this manager. Calling it more than once
   * for the same request reopens the scope - guards created before the
   * rebind (and their memoised users / viaRemember state) are dropped and
   * re-resolved from the session, so call it once per request.
   * Laravel: the per-request `auth.session`/`request` container refreshes
   */
  forRequest(request: Request, response?: Response): this {
    this.scope = { request, response, guards: new Map() };

    request.setUserResolver((guard?: string) => this.guard(guard).user());
    request.setGuardResolver((guard?: string) => this.guard(guard));

    return this;
  }

  /**
   * The request the current guard scope belongs to, if any
   */
  currentRequest(): Request | null {
    return this.scope?.request ?? null;
  }

  /**
   * Forget every built guard and provider (configuration changed, tests)
   */
  forgetGuards(): this {
    this.guards.clear();
    this.resolvedProviders.clear();
    this.scope = null;

    return this;
  }

  // ---------------------------------------------------------------------
  // Default-guard forwarding, like Laravel's AuthManager::__call()
  // ---------------------------------------------------------------------

  /**
   * The authenticated user of the default guard
   */
  async user<T extends Authenticatable = Authenticatable>(): Promise<T | null> {
    return (await this.guard().user()) as T | null;
  }

  /**
   * The default guard's user identifier
   */
  async id(): Promise<any> {
    return this.guard().id();
  }

  /**
   * Whether the default guard has an authenticated user
   */
  async check(): Promise<boolean> {
    return this.guard().check();
  }

  /**
   * Whether the default guard has no authenticated user
   */
  async guest(): Promise<boolean> {
    return this.guard().guest();
  }

  /**
   * Attempt authentication on the default guard
   */
  async attempt(credentials: AuthCredentials, remember: boolean = false): Promise<boolean> {
    return this.guard().attempt(credentials, remember);
  }

  /**
   * Log a user in on the default guard
   */
  async login(user: Authenticatable | number | string, remember: boolean = false): Promise<void> {
    return this.guard().login(user, remember);
  }

  /**
   * Log in a user by identifier on the default guard
   */
  async loginUsingId(identifier: any, remember: boolean = false): Promise<Authenticatable> {
    return this.guard().loginUsingId(identifier, remember);
  }

  /**
   * Log the default guard's user out
   */
  async logout(): Promise<void> {
    return this.guard().logout();
  }

  /**
   * Validate credentials against the default guard's provider
   */
  async validate(credentials: AuthCredentials): Promise<boolean> {
    return this.guard().validate(credentials);
  }

  /**
   * Whether the default guard authenticated via a remember cookie
   */
  viaRemember(): boolean {
    return this.guard().viaRemember();
  }

  /**
   * Build one guard from its auth.guards entry; custom drivers (extend)
   * win over the built-in session/token pair, like Laravel's
   * createGuard().
   */
  protected createGuard(name: string): StatefulGuard {
    const config = this.config.guards[name];

    if (!config) {
      throw new Error(
        `Auth guard [${name}] is not defined. Available guards: ${Object.keys(this.config.guards).join(', ')}.`
      );
    }

    const custom = this.customExtensions.get(config.driver);

    if (custom) {
      return custom(name, config, this);
    }

    switch (config.driver) {
      case 'session':
        return this.createSessionDriver(name, config);
      case 'token':
        return this.createTokenDriver(name, config);
      default:
        throw new Error(
          `Auth guard driver [${config.driver}] is not defined. Built-in drivers: session, token` +
            (this.customExtensions.size > 0 ? `, ${Array.from(this.customExtensions.keys()).join(', ')}` : '') +
            '.'
        );
    }
  }

  /**
   * Laravel: AuthManager::createSessionDriver()
   */
  protected createSessionDriver(name: string, config: AuthGuardConfig): SessionGuard {
    const session = this.dependencies.session;

    if (!session) {
      throw new Error(
        `Session guard [${name}] needs a session resolver: register the SessionServiceProvider (the ` +
          'AuthServiceProvider wires it automatically) or pass { session } to the AuthManager.'
      );
    }

    const scope = this.scope;

    return new SessionGuard(name, this.provider(config.provider), session, {
      request: scope?.request,
      response: scope?.response,
      cookie: config.cookie,
    });
  }

  /**
   * Laravel: AuthManager::createTokenDriver()
   */
  protected createTokenDriver(name: string, config: AuthGuardConfig & TokenGuardConfig): TokenGuard {
    const guardConfig: TokenGuardConfig = {
      input: config.input ?? 'api_token',
      token: config.token ?? 'api_token',
      hash: config.hash ?? false,
    };

    return new TokenGuard(name, this.provider(config.provider), guardConfig, this.scope?.request);
  }

  /**
   * Merge a keyed config section (guards/providers) over the defaults,
   * keeping per-entry keys from both so partial app config extends rather
   * than replaces the built-in entries
   */
  private mergeSection<T extends Record<string, any>>(
    defaults: Record<string, T>,
    overrides?: Record<string, T>
  ): Record<string, T> {
    const merged: Record<string, T> = {};

    for (const [key, value] of Object.entries(defaults)) {
      merged[key] = { ...value };
    }

    for (const [key, value] of Object.entries(overrides ?? {})) {
      merged[key] = { ...(merged[key] ?? {}), ...value };
    }

    return merged;
  }
}
