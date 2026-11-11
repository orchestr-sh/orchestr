/**
 * SessionGuard
 *
 * The cookie/session-driven guard: logins write the user's identity into the
 * session (regenerating the session ID so a pre-login cookie can never be
 * reused as an authenticated one), and later requests resolve the user back
 * out of the session through the provider. Remember-me logins persist a
 * random token on the user via the provider and queue a `id|token` recaller
 * cookie, which is validated against the store on subsequent requests after
 * the session itself has gone.
 *
 * Mirrors Illuminate\Auth\SessionGuard. Guards own authentication, providers
 * own user retrieval (SRP); cookie reads/writes go through the Request and
 * Response bound to this guard for the running request.
 *
 * @example
 * ```typescript
 * const guard = new SessionGuard('session', provider, () => manager.current());
 * guard.setRequest(request);
 * guard.setResponse(response);
 *
 * await guard.attempt({ email: 'ada@example.com', password: 'secret' }, true);
 * ```
 */

import type { Authenticatable } from '@/Auth/Contracts/Authenticatable';
import type { StatefulGuard } from '@/Auth/Contracts/Guard';
import type { AuthCredentials, UserProvider } from '@/Auth/Contracts/UserProvider';
import type { Request } from '@/Routing/Request';
import type { CookieOptions } from '@/Routing/Response';
import type { Response } from '@/Routing/Response';
import type { Store } from '@/Session/Contracts/Store';
import { AuthenticationException } from '@/Foundation/Exceptions/AuthenticationException';
import { Str } from '@/Support/Str';
import { UserNotFoundException } from './UserNotFoundException';

/**
 * Laravel's remember cookie lives for five years
 */
const RECALLER_LIFETIME_SECONDS = 60 * 60 * 24 * 365 * 5;

/**
 * Default attributes for the recaller cookie: readable only by the browser,
 * long-lived, first-party by default
 */
const RECALLER_COOKIE_OPTIONS: CookieOptions = {
  path: '/',
  httpOnly: true,
  sameSite: 'Lax',
};

/**
 * A parsed remember-me recaller cookie value (`{id}|{token}`)
 */
interface Recaller {
  identifier: any;
  token: string;
}

/**
 * Per-request collaborators a guard reads cookies from and queues its
 * remember cookie onto
 */
export interface SessionGuardOptions {
  request?: Request;
  response?: Response;
  /**
   * Extra cookie attributes merged over the defaults for the recaller
   * cookie (domain, secure, custom path ...)
   */
  cookie?: CookieOptions;
}

export class SessionGuard implements StatefulGuard {
  /**
   * Memoised user for this guard instance, like Laravel's $this->user
   */
  protected resolvedUser: Authenticatable | null = null;

  /**
   * Whether user() has already resolved for the bound request
   */
  protected userResolved: boolean = false;

  /**
   * Set when the current user arrived through the recaller cookie
   */
  protected usingRecaller: boolean = false;

  /**
   * The last user an attempt() matched, authenticated or not
   */
  protected lastAttempted: Authenticatable | null = null;

  protected request?: Request;

  protected response?: Response;

  protected readonly cookieOptions: CookieOptions;

  constructor(
    /**
     * Guard name; keys the session entries and recaller cookie after it,
     * like Laravel's $name
     */
    public readonly name: string,
    protected readonly provider: UserProvider,
    /**
     * Resolves the session store for the running request; a Store instance
     * is accepted for single-request (CLI/test) use
     */
    protected readonly session: Store | (() => Store | null),
    options: SessionGuardOptions = {}
  ) {
    this.request = options.request;
    this.response = options.response;
    this.cookieOptions = { ...RECALLER_COOKIE_OPTIONS, ...(options.cookie ?? {}) };
  }

  /**
   * Bind the request this guard should read cookies from
   * Laravel: SessionGuard::setRequest() (wired through refresh('request'))
   */
  setRequest(request: Request): void {
    this.request = request;
  }

  /**
   * Bind the response this guard queues its remember cookie onto
   * Laravel: SessionGuard::setResponse()
   */
  setResponse(response: Response): void {
    this.response = response;
  }

  /**
   * The currently authenticated user: session first, then the remember
   * cookie, then guest
   * Laravel: SessionGuard::user()
   */
  async user<T extends Authenticatable = Authenticatable>(): Promise<T | null> {
    if (this.userResolved) {
      return this.resolvedUser as T | null;
    }

    let user: Authenticatable | null = null;

    const store = this.resolveSession();

    if (store && store.get(this.getName()) === true) {
      const identifier = store.get(`${this.getName()}_login_id`);

      if (identifier !== null && identifier !== undefined) {
        user = await this.provider.retrieveById(identifier);
      }
    }

    if (!user) {
      const recaller = this.recaller();

      if (recaller) {
        user = await this.userFromRecaller(recaller);
      }
    }

    this.resolvedUser = user;
    this.userResolved = true;

    return user as T | null;
  }

  /**
   * The identifier of the authenticated user, or the one still parked in
   * the session for a remember-me authentication
   * Laravel: SessionGuard::id()
   */
  async id(): Promise<any> {
    const user = await this.user();

    if (user) {
      return user.getAuthIdentifier();
    }

    return this.resolveSession()?.get(`${this.getName()}_login_id`) ?? null;
  }

  /**
   * Determine whether any user is authenticated
   */
  async check(): Promise<boolean> {
    return (await this.user()) !== null;
  }

  /**
   * Determine whether the request has no authenticated user
   */
  async guest(): Promise<boolean> {
    return !(await this.check());
  }

  /**
   * Determine whether credentials match a user, without logging them in
   * Laravel: SessionGuard::validate()
   */
  async validate(credentials: AuthCredentials): Promise<boolean> {
    return (await this.provider.retrieveByCredentials(credentials)) !== null;
  }

  /**
   * Attempt to log in with credentials (e.g. `{ email, password }`).
   * Resolves true on success; throws AuthenticationException when the
   * credentials do not match a user.
   * Laravel: SessionGuard::attempt()
   */
  async attempt(credentials: AuthCredentials, remember: boolean = false): Promise<boolean> {
    const user = await this.provider.retrieveByCredentials(credentials);

    this.lastAttempted = user;

    if (user && (await this.provider.validateCredentials(user, credentials))) {
      await this.login(user, remember);

      return true;
    }

    throw new AuthenticationException('These credentials do not match our records.');
  }

  /**
   * The user matched by the most recent attempt()
   */
  getLastAttempted(): Authenticatable | null {
    return this.lastAttempted;
  }

  /**
   * Log a user (or a numeric/string identifier) in, optionally issuing the
   * remember-me token and queuing its cookie
   * Laravel: SessionGuard::login()
   */
  async login(userOrIdentifier: Authenticatable | number | string, remember: boolean = false): Promise<void> {
    if (typeof userOrIdentifier === 'number' || typeof userOrIdentifier === 'string') {
      await this.loginUsingId(userOrIdentifier, remember);
      return;
    }

    const user = userOrIdentifier;

    this.updateSession(user.getAuthIdentifier());

    // A fresh authenticated session ID; the pre-login one is dead
    this.sessionStore().regenerate();

    this.resolvedUser = user;
    this.userResolved = true;
    this.usingRecaller = false;

    if (remember) {
      if (!user.getRememberToken()) {
        await this.provider.updateRememberToken(user, Str.random(60));
      }

      this.queueRecallerCookie(user);
    }
  }

  /**
   * Log in the user with the given identifier
   * Laravel: SessionGuard::loginUsingId()
   */
  async loginUsingId(identifier: any, remember: boolean = false): Promise<Authenticatable> {
    const user = await this.provider.retrieveById(identifier);

    if (!user) {
      throw new UserNotFoundException();
    }

    await this.login(user, remember);

    return user;
  }

  /**
   * Log the user out: the session entries, the session ID and the stored
   * remember token all go away, and the recaller cookie is expired
   * Laravel: SessionGuard::logout()
   */
  async logout(): Promise<void> {
    const user = await this.user();

    this.clearRecallerCookie();

    const store = this.sessionStore();
    store.forget([`${this.getName()}_login_id`, this.getName()]);
    store.regenerate();

    if (user && user.getRememberToken()) {
      await this.provider.updateRememberToken(user, null);
    }

    this.resolvedUser = null;
    this.userResolved = true;
    this.usingRecaller = false;
  }

  /**
   * Whether the current user was authenticated from the remember cookie
   * rather than the session payload
   * Laravel: SessionGuard::viaRemember()
   */
  viaRemember(): boolean {
    return this.userResolved && this.resolvedUser !== null && this.usingRecaller;
  }

  /**
   * The session key prefix for this guard: `login_{name}_user`, exactly
   * Laravel's getName()
   */
  getName(): string {
    return `login_${this.name}_user`;
  }

  /**
   * The recaller cookie name: `remember_{name}_recaller`
   * Laravel: SessionGuard::getRecallerName()
   */
  getRecallerName(): string {
    return `remember_${this.name}_recaller`;
  }

  /**
   * The provider this guard retrieves users through
   */
  getProvider(): UserProvider {
    return this.provider;
  }

  /**
   * The parsed recaller cookie, or null when absent/malformed
   * Laravel: SessionGuard::recaller()
   */
  protected recaller(): Recaller | null {
    const raw = this.request?.cookie(this.getRecallerName());

    if (!raw) {
      return null;
    }

    const separator = raw.indexOf('|');

    if (separator <= 0 || separator === raw.length - 1) {
      return null;
    }

    return { identifier: raw.slice(0, separator), token: raw.slice(separator + 1) };
  }

  /**
   * Resolve the recaller's identifier + token into a user, re-establishing
   * the session when the token matches the stored one
   * Laravel: SessionGuard::userFromRecaller()
   */
  protected async userFromRecaller(recaller: Recaller): Promise<Authenticatable | null> {
    const user = await this.provider.retrieveByToken(recaller.identifier, recaller.token);

    if (user) {
      this.updateSession(user.getAuthIdentifier());
      this.usingRecaller = true;
    }

    return user;
  }

  /**
   * Write the login session keys: the identifier plus the boolean marker
   * Laravel: SessionGuard::updateSession()
   */
  protected updateSession(identifier: any): void {
    const store = this.sessionStore();

    store.forget(`${this.getName()}_login_id`);
    store.put(`${this.getName()}_login_id`, identifier);
    store.put(this.getName(), true);
  }

  /**
   * Queue the `id|token` recaller cookie onto the bound response
   * Laravel: SessionGuard::queueRecallerCookie() via the cookie jar
   */
  protected queueRecallerCookie(user: Authenticatable): void {
    const token = user.getRememberToken();

    if (!token) {
      throw new Error('Cannot queue the remember cookie: the user has no remember token.');
    }

    if (!this.response) {
      throw new Error(
        `Cannot queue the remember cookie for guard [${this.name}]: no response bound. ` +
          'Authenticate through the auth middleware, or call Auth.forRequest(request, response) first.'
      );
    }

    this.response.cookie(this.getRecallerName(), `${user.getAuthIdentifier()}|${token}`, this.recallerCookieOptions());
  }

  /**
   * Expire the recaller cookie on the bound response (no-op for guests or
   * when no response is bound, e.g. console flows)
   * Laravel: SessionGuard::clearRecaller()
   */
  protected clearRecallerCookie(): void {
    if (!this.response) {
      return;
    }

    if (!this.request?.cookie(this.getRecallerName())) {
      return;
    }

    this.response.cookie(this.getRecallerName(), '', {
      ...this.recallerCookieOptions(),
      maxAge: 0,
      expires: new Date(0),
    });
  }

  /**
   * Cookie attributes for the long-lived remember cookie
   */
  protected recallerCookieOptions(): CookieOptions {
    return {
      ...this.cookieOptions,
      maxAge: RECALLER_LIFETIME_SECONDS,
      expires: new Date(Date.now() + RECALLER_LIFETIME_SECONDS * 1000),
    };
  }

  /**
   * Session store for stateful operations; throws a helpful error when the
   * session subsystem is not wired up
   */
  protected sessionStore(): Store {
    const store = this.resolveSession();

    if (!store) {
      throw new Error(
        `Session guard [${this.name}] needs the session subsystem: register the SessionServiceProvider ` +
          'and run the StartSession middleware before authenticating.'
      );
    }

    return store;
  }

  protected resolveSession(): Store | null {
    return typeof this.session === 'function' ? this.session() : this.session;
  }
}
