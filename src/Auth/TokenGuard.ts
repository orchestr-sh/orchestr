/**
 * TokenGuard
 *
 * Stateless bearer-token authentication: every request presents the token
 * (via `Authorization: Bearer ...` or a configurable query/input key) and
 * the guard resolves the owning user through the provider. Nothing is
 * persisted between requests, so login/attempt throw - mirroring
 * Illuminate\Auth\TokenGuard.
 *
 * With `hash: true` the submitted token is compared the Laravel 11 way:
 * the lookup value is the SHA-256 hex digest of the token, matching tokens
 * stored in digested form so a leaked table cannot be replayed.
 */

import { createHash } from 'crypto';
import type { Authenticatable } from '@/Auth/Contracts/Authenticatable';
import type { StatefulGuard } from '@/Auth/Contracts/Guard';
import type { UserProvider } from '@/Auth/Contracts/UserProvider';
import type { Request } from '@/Routing/Request';

/**
 * `auth.guards.*` entries for the token driver
 */
export interface TokenGuardConfig {
  /**
   * Query/body key the token may also be read from when there is no
   * Authorization header (Laravel: 'api_token')
   */
  input?: string;
  /**
   * Column on the user model holding the stored token
   */
  token?: string;
  /**
   * Compare against the SHA-256 hex digest of the submitted token
   */
  hash?: boolean;
}

export class TokenGuard implements StatefulGuard {
  protected resolvedUser: Authenticatable | null | undefined;

  protected request?: Request;

  protected readonly inputKey: string;

  protected readonly storageKey: string;

  protected readonly hashed: boolean;

  constructor(
    public readonly name: string,
    protected readonly provider: UserProvider,
    config: TokenGuardConfig = {},
    request?: Request
  ) {
    this.inputKey = config.input ?? 'api_token';
    this.storageKey = config.token ?? 'api_token';
    this.hashed = config.hash === true;
    this.request = request;
  }

  /**
   * Bind the request whose header/input carries the bearer token
   */
  setRequest(request: Request): void {
    this.request = request;
    this.resolvedUser = undefined;
  }

  /**
   * The user owning the presented token, or null for guests
   * Laravel: TokenGuard::user()
   */
  async user<T extends Authenticatable = Authenticatable>(): Promise<T | null> {
    if (this.resolvedUser !== undefined) {
      return this.resolvedUser as T | null;
    }

    const token = this.token();

    this.resolvedUser = token
      ? await this.provider.retrieveByCredentials({ [this.storageKey]: this.digest(token) })
      : null;

    return this.resolvedUser as T | null;
  }

  /**
   * The identifier of the token's owner
   * Laravel: TokenGuard::id()
   */
  async id(): Promise<any> {
    const user = await this.user();

    return user ? user.getAuthIdentifier() : null;
  }

  /**
   * The bearer token for this request: `Authorization: Bearer ...` first,
   * then the configured query/input key
   * Laravel: TokenGuard::getTokenForRequest()
   */
  token(): string | null {
    const bearer = this.request?.bearerToken();

    if (bearer) {
      return bearer;
    }

    const fromInput = this.request?.input(this.inputKey);

    return typeof fromInput === 'string' && fromInput !== '' ? fromInput : null;
  }

  /**
   * The value stored for a submitted token: the raw token, or its SHA-256
   * digest when the guard hashes tokens
   */
  digest(token: string): string {
    return this.hashed ? TokenGuard.hashToken(token) : token;
  }

  /**
   * SHA-256 hex digest matching `hash('sha256', $value)` in Laravel
   */
  static hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Determine whether credentials (as accepted by the provider, e.g.
   * `{ api_token }`) resolve to a user. A token submitted under the input
   * key is digested like a request token.
   */
  async validate(credentials: Record<string, any>): Promise<boolean> {
    const normalized = { ...credentials };
    const raw = normalized[this.inputKey] ?? normalized[this.storageKey];

    if (this.hashed && typeof raw === 'string') {
      delete normalized[this.inputKey];
      normalized[this.storageKey] = this.digest(raw);
    }

    return (await this.provider.retrieveByCredentials(normalized)) !== null;
  }

  /**
   * Forget the memoised user - there is nothing stored server-side to
   * revoke.
   * Laravel: TokenGuard::logout()
   */
  async logout(): Promise<void> {
    this.resolvedUser = undefined;
  }

  /**
   * Bearer tokens are presented on every request; there is no
   * remember-me concept
   */
  viaRemember(): boolean {
    return false;
  }

  /**
   * Session-free guards cannot log users in
   * Laravel: TokenGuard::attempt() throws RuntimeException
   */
  async attempt(_credentials: Record<string, any>, _remember?: boolean): Promise<boolean> {
    throw new Error(`Guard [${this.name}] is stateless and does not support [attempt].`);
  }

  /**
   * Session-free guards cannot log users in
   */
  async login(_user: Authenticatable | number | string, _remember?: boolean): Promise<void> {
    throw new Error(`Guard [${this.name}] is stateless and does not support [login].`);
  }

  /**
   * Session-free guards cannot log users in
   */
  async loginUsingId(_identifier: any, _remember?: boolean): Promise<Authenticatable> {
    throw new Error(`Guard [${this.name}] is stateless and does not support [loginUsingId].`);
  }

  async check(): Promise<boolean> {
    return (await this.user()) !== null;
  }

  async guest(): Promise<boolean> {
    return !(await this.check());
  }
}
