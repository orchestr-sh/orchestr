/**
 * SessionManager
 *
 * Builds session stores from configuration and keeps track of the session
 * the running request is using. Follows the manager pattern established by
 * CacheManager: built-in array/file/cookie drivers are registered up front,
 * and extend() adds new ones without touching this class (OCP).
 *
 * Mirrors Illuminate\Session\SessionManager.
 *
 * @example
 * ```typescript
 * const manager = new SessionManager({ driver: 'file', files: 'storage/framework/sessions' });
 * const session = manager.store(undefined, req.cookie('orchestr_session'));
 * session.start();
 * ```
 */

import type { CookieOptions } from '@/Routing/Response';
import type { Store } from '@/Session/Contracts/Store';
import type { SessionStoreConfig } from '@/Session/Stores/BaseSessionStore';
import { ArraySessionStore } from '@/Session/Stores/ArraySessionStore';
import { CookieSessionStore } from '@/Session/Stores/CookieSessionStore';
import { FileSessionStore } from '@/Session/Stores/FileSessionStore';
import { Str } from '@/Support/Str';

/**
 * A session driver factory: builds a store from its config and session ID
 */
export type SessionDriverFactory = (config: SessionStoreConfig, id: string) => Store;

/**
 * The full session configuration, one key per Laravel config/session.php
 * entry this port supports
 */
export interface SessionConfig {
  /** Default driver name */
  driver: string;
  /** Session lifetime in minutes */
  lifetime: number;
  /** Expire the cookie when the browser closes instead of after the lifetime */
  expire_on_close: boolean;
  /** Session cookie name */
  cookie: string;
  /** Cookie path */
  path: string;
  /** Cookie domain; omitted when unset */
  domain?: string;
  /** Force the Secure cookie flag; defaults to the environment in the provider */
  secure?: boolean;
  /** HttpOnly flag - on by default so scripts cannot read the session ID */
  http_only: boolean;
  /** SameSite policy - Lax by default */
  same_site: 'Strict' | 'Lax' | 'None';
  /** Path for file-session storage */
  files: string;
  /** Application key used to sign cookie-session payloads */
  key?: string;
  /** Probability (0-1) that a file write also garbage-collects expired sessions */
  gc_probability?: number;
  /** Per-store configuration keyed by store name */
  stores: Record<string, SessionStoreConfig>;
}

/**
 * Session IDs are exactly 40 alphanumeric characters, like Laravel's
 * Store::isValidId(); anything else in a cookie is treated as absent so
 * hostile values can never reach the filesystem as file names.
 */
const SESSION_ID_PATTERN = /^[a-zA-Z0-9]{40}$/;

/**
 * Default configuration merged under whatever the app provides
 */
export const SESSION_DEFAULTS: SessionConfig = {
  driver: 'file',
  lifetime: 120,
  expire_on_close: false,
  cookie: 'orchestr_session',
  path: '/',
  http_only: true,
  same_site: 'Lax',
  files: 'storage/framework/sessions',
  stores: {
    array: { driver: 'array' },
    file: { driver: 'file' },
    cookie: { driver: 'cookie' },
  },
};

export class SessionManager {
  public readonly config: SessionConfig;

  protected drivers: Map<string, SessionDriverFactory> = new Map();

  /**
   * The session the current request is working with - the facade and the
   * session() helper resolve their target here
   */
  private currentSession: Store | null = null;

  constructor(config: Partial<SessionConfig> = {}) {
    this.config = {
      ...SESSION_DEFAULTS,
      ...config,
      stores: { ...SESSION_DEFAULTS.stores, ...(config.stores ?? {}) },
    };

    this.registerDriver('array', (storeConfig, id) => new ArraySessionStore(storeConfig, id));
    this.registerDriver('file', (storeConfig, id) => new FileSessionStore(storeConfig, id));
    this.registerDriver('cookie', (storeConfig, id) => new CookieSessionStore(storeConfig, id));
  }

  /**
   * Register a session driver factory
   * Laravel: SessionManager::extend()
   */
  extend(name: string, factory: SessionDriverFactory): this {
    this.registerDriver(name, factory);
    return this;
  }

  /**
   * Alias of extend for symmetry with CacheManager
   */
  registerDriver(name: string, factory: SessionDriverFactory): void {
    this.drivers.set(name, factory);
  }

  /**
   * The default driver name
   */
  getDefaultDriver(): string {
    return this.config.driver;
  }

  /**
   * Build a fresh session store, adopting the ID carried by the request's
   * session cookie when there is one. Session stores are per-request, so
   * every call hands back a new instance
   * Laravel: SessionManager::driver() / buildSession()
   */
  store(name?: string, rawCookie: string | null = null): Store {
    const storeName = name ?? this.config.driver;
    const storeConfig = this.config.stores[storeName];

    if (!storeConfig) {
      throw new Error(`Session store [${storeName}] not configured.`);
    }

    const factory = this.drivers.get(storeConfig.driver);

    if (!factory) {
      throw new Error(
        `Session driver [${storeConfig.driver}] not registered. ` +
          `Available drivers: ${Array.from(this.drivers.keys()).join(', ')}`
      );
    }

    const id = this.validSessionId(rawCookie) ?? this.generateSessionId();
    const store = factory(this.storeConfiguration(storeConfig), id);

    // Cookie-carried drivers want the raw payload before start() reads
    // through them; ID-carrying drivers simply keep the sanitized cookie ID
    if (rawCookie && store.loadRawPayload) {
      store.loadRawPayload(rawCookie);
    }

    return store;
  }

  /**
   * The session bound to the current request, if any
   * Laravel: the 'session.store' container binding
   */
  current(): Store | null {
    return this.currentSession;
  }

  /**
   * Track the session a request started so the facade and helpers can
   * reach it
   */
  setCurrent(session: Store): void {
    this.currentSession = session;
  }

  /**
   * Stop tracking a session (after its request finished)
   */
  forgetCurrent(): void {
    this.currentSession = null;
  }

  /**
   * A brand-new random session ID (40 alphanumeric characters, like
   * Laravel's Store::generateSessionId)
   */
  generateSessionId(): string {
    return Str.random(40);
  }

  /**
   * Accept a cookie-supplied ID only when it is shaped like ours
   */
  private validSessionId(candidate: string | null): string | null {
    return candidate && SESSION_ID_PATTERN.test(candidate) ? candidate : null;
  }

  /**
   * Merge the global values every driver needs under the store's own
   * configuration so per-store entries win
   */
  private storeConfiguration(storeConfig: SessionStoreConfig): SessionStoreConfig {
    const merged: SessionStoreConfig = {
      lifetime: this.config.lifetime,
      expire_on_close: this.config.expire_on_close,
      key: this.config.key,
      gc_probability: this.config.gc_probability,
      ...storeConfig,
    };

    if (merged.driver === 'file' && !merged.path) {
      merged.path = this.config.files;
    }

    return merged;
  }

  /**
   * Session cookie name
   */
  getCookieName(): string {
    return this.config.cookie;
  }

  /**
   * Cookie attributes applied to the session cookie: HttpOnly,
   * SameSite=Lax, Secure in production, path/domain/lifetime from config
   */
  getCookieOptions(): CookieOptions {
    const options: CookieOptions = {
      path: this.config.path || '/',
      httpOnly: this.config.http_only,
      secure: this.config.secure,
      sameSite: this.config.same_site,
    };

    if (this.config.domain) {
      options.domain = this.config.domain;
    }

    if (!this.config.expire_on_close && this.config.lifetime > 0) {
      const seconds = this.config.lifetime * 60;
      options.maxAge = seconds;
      options.expires = new Date(Date.now() + seconds * 1000);
    }

    return options;
  }
}
