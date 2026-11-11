/**
 * Authenticatable Contract
 *
 * The surface an authenticated user must expose: an identifier, a password
 * and a remember token, each paired with the column name it lives in.
 * Mirrors Illuminate\Contracts\Auth\Authenticatable; models gain the
 * methods through the HasAuthenticatable concern, exactly like Laravel's
 * `use Illuminate\Auth\Authenticatable` trait on the User model.
 */
export interface Authenticatable {
  /**
   * The name of the unique identifier column
   * Laravel: Authenticatable::getAuthIdentifierName()
   */
  getAuthIdentifierName(): string;

  /**
   * The user's unique identifier value
   * Laravel: Authenticatable::getAuthIdentifier()
   */
  getAuthIdentifier(): any;

  /**
   * The name of the password column
   * Laravel: Authenticatable::getAuthPasswordName()
   */
  getAuthPasswordName(): string;

  /**
   * The hashed password, or null when the user has none
   * Laravel: Authenticatable::getAuthPassword()
   */
  getAuthPassword(): string | null;

  /**
   * The current remember-me token, or null when none is stored yet
   * Laravel: Authenticatable::getRememberToken()
   */
  getRememberToken(): string | null;

  /**
   * Write a remember-me token onto the user (persisting is the provider's job)
   * Laravel: Authenticatable::setRememberToken()
   */
  setRememberToken(token: string | null): void;

  /**
   * The column holding the remember token; empty string disables remember me
   * Laravel: Authenticatable::getRememberTokenName()
   */
  getRememberTokenName(): string;
}
