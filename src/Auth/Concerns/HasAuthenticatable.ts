/**
 * HasAuthenticatable Concern
 *
 * The port of Laravel's `Illuminate\Auth\Authenticatable` trait: gives an
 * attribute-carrying model (Ensemble and subclasses) the Authenticatable
 * contract by reading and writing the identifier, password and remember
 * token columns from the model's attributes.
 *
 * Column names default to the primary key, `password` and `remember_token`;
 * subclasses opt out of remember-me support the Laravel way, by overriding
 * the protected fields (empty remember token name disables it).
 *
 * @example
 * ```typescript
 * class User extends HasAuthenticatable(Ensemble) {
 *   static fillable = ['name', 'email', 'password'];
 *
 *   getTable(): string {
 *     return 'users';
 *   }
 * }
 * ```
 */

import type { Authenticatable } from '@/Auth/Contracts/Authenticatable';

/**
 * The model surface the concern builds on: attribute access plus the
 * primary-key name Ensemble already exposes
 */
export interface AttributeCarrier {
  getAttribute(key: string): any;
  setAttribute(key: string, value: any): unknown;
  getKeyName(): string;
}

/**
 * Constructor type accepting both concrete and abstract classes so the
 * mixin can wrap Ensemble itself
 */
export type ModelConstructor<T extends AttributeCarrier = AttributeCarrier> = abstract new (...args: any[]) => T;

/**
 * The instance type produced by the mixin
 */
export type AuthenticatableInstance = AttributeCarrier & Authenticatable;

export function HasAuthenticatable<T extends ModelConstructor>(Base: T): T & ModelConstructor<AuthenticatableInstance> {
  abstract class HasAuthenticatableMixin extends Base implements Authenticatable {
    /**
     * The column holding the remember token; '' disables remember me
     * Laravel: Authenticatable::$rememberTokenName
     */
    protected rememberTokenName: string = 'remember_token';

    /**
     * The column holding the hashed password
     * Laravel: Authenticatable::getAuthPasswordName()
     */
    protected authPasswordName: string = 'password';

    /**
     * The identifier column is the model's primary key
     * Laravel: Authenticatable::getAuthIdentifierName()
     */
    getAuthIdentifierName(): string {
      return this.getKeyName();
    }

    /**
     * The user's value for the identifier column
     */
    getAuthIdentifier(): any {
      const identifier = this.getAttribute(this.getAuthIdentifierName());

      return identifier === undefined ? null : identifier;
    }

    /**
     * The password column name
     */
    getAuthPasswordName(): string {
      return this.authPasswordName;
    }

    /**
     * The hashed password stored on the user
     */
    getAuthPassword(): string | null {
      const password = this.getAttribute(this.getAuthPasswordName());

      return password === undefined || password === null ? null : String(password);
    }

    /**
     * The persisted remember-me token, when the model supports it
     */
    getRememberToken(): string | null {
      if (!this.getRememberTokenName()) {
        return null;
      }

      const token = this.getAttribute(this.getRememberTokenName());

      return token === undefined || token === null ? null : String(token);
    }

    /**
     * Write a new remember-me token onto the model (persisting is the
     * provider's job, like Laravel's EloquentUserProvider::updateRememberToken)
     */
    setRememberToken(token: string | null): void {
      if (!this.getRememberTokenName()) {
        return;
      }

      this.setAttribute(this.getRememberTokenName(), token);
    }

    /**
     * The remember-token column name
     */
    getRememberTokenName(): string {
      return this.rememberTokenName;
    }
  }

  return HasAuthenticatableMixin as unknown as T & ModelConstructor<AuthenticatableInstance>;
}
