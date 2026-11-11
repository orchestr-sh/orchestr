/**
 * UserProvider Contract
 *
 * Guards own authentication; providers own user retrieval. This is the seam
 * between the two: a provider knows how to find users by identifier, by
 * remember token, and by credentials, and how to persist a remember token.
 * Mirrors Illuminate\Contracts\Auth\UserProvider.
 */

import type { Authenticatable } from './Authenticatable';

/**
 * Authentication credentials such as `{ email, password }`; the shape is
 * defined by the provider's configured credential columns
 */
export type AuthCredentials = Record<string, any>;

export interface UserProvider {
  /**
   * Retrieve a user by their unique identifier
   * Laravel: UserProvider::retrieveById()
   */
  retrieveById(identifier: any): Promise<Authenticatable | null>;

  /**
   * Retrieve a user by their identifier and remember-me token
   * Laravel: UserProvider::retrieveByToken()
   */
  retrieveByToken(identifier: any, token: string): Promise<Authenticatable | null>;

  /**
   * Persist a new remember-me token for the user (null clears it)
   * Laravel: UserProvider::updateRememberToken()
   */
  updateRememberToken(user: Authenticatable, token: string | null): Promise<void>;

  /**
   * Retrieve a user matching the non-password credential columns
   * Laravel: UserProvider::retrieveByCredentials()
   */
  retrieveByCredentials(credentials: AuthCredentials): Promise<Authenticatable | null>;

  /**
   * Verify the plaintext credentials against the retrieved user
   * Laravel: UserProvider::validateCredentials()
   */
  validateCredentials(user: Authenticatable, credentials: AuthCredentials): Promise<boolean>;
}
