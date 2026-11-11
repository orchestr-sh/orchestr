/**
 * Guard Contracts
 *
 * A guard is the authentication layer facing the request: it answers who is
 * logged in and (for stateful guards) performs login/logout flows. Guards
 * never talk to storage directly - user retrieval and credential checking
 * belong to the UserProvider contract (SRP), mirroring
 * Illuminate\Contracts\Auth\Guard and StatefulGuard.
 */

import type { Request } from '@/Routing/Request';
import type { Response } from '@/Routing/Response';
import type { Authenticatable } from './Authenticatable';
import type { AuthCredentials } from './UserProvider';

/**
 * A guard that tracks authentication across requests: the session cookie
 * (and remember-me recaller) keeps the user logged in between requests.
 */
export interface StatefulGuard {
  /**
   * The currently authenticated user, or null for guests. The type
   * parameter lets callers ask for their concrete model class.
   * Laravel: StatefulGuard::user()
   */
  user<T extends Authenticatable = Authenticatable>(): Promise<T | null>;

  /**
   * The identifier of the current user, or the pending session's stored id
   * Laravel: StatefulGuard::id()
   */
  id(): Promise<any>;

  /**
   * Determine whether any user is authenticated
   */
  check(): Promise<boolean>;

  /**
   * Determine whether the request has no authenticated user
   */
  guest(): Promise<boolean>;

  /**
   * Validate credentials without logging the user in
   * Laravel: StatefulGuard::validate()
   */
  validate(credentials: AuthCredentials): Promise<boolean>;

  /**
   * Attempt authentication with credentials; throws AuthenticationException
   * when the credentials do not match a user
   * Laravel: StatefulGuard::attempt()
   */
  attempt(credentials: AuthCredentials, remember?: boolean): Promise<boolean>;

  /**
   * Log a user in, optionally issuing a remember-me token. A numeric or
   * string argument is treated as an identifier (loginUsingId), like
   * Laravel's `is_numeric($user)` branch.
   * Laravel: StatefulGuard::login()
   */
  login(user: Authenticatable | number | string, remember?: boolean): Promise<void>;

  /**
   * Log in the user with the given identifier
   * Laravel: StatefulGuard::loginUsingId()
   */
  loginUsingId(identifier: any, remember?: boolean): Promise<Authenticatable>;

  /**
   * Log the user out: clear the session keys and the remember token
   * Laravel: StatefulGuard::logout()
   */
  logout(): Promise<void>;

  /**
   * Determine whether the current user was authenticated from a
   * remember-me cookie rather than the session
   * Laravel: StatefulGuard::viaRemember()
   */
  viaRemember(): boolean;

  /**
   * Bind the request the guard should read cookies from (port seam for
   * Laravel's per-request guard lifecycle)
   */
  setRequest?(request: Request): void;

  /**
   * Bind the response the guard should queue cookies onto (port seam)
   */
  setResponse?(response: Response): void;
}

/**
 * A stateless guard: authentication is resolved from the request itself
 * (e.g. a bearer token) and nothing is persisted between requests.
 * Laravel: Illuminate\Contracts\Auth\Guard
 */
export type Guard = StatefulGuard;
