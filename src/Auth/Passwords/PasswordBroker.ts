/**
 * PasswordBroker - the password reset flow, start to finish
 *
 * Mirrors Illuminate\Auth\Passwords\PasswordBroker. The broker owns the
 * flow (SRP): it looks users up through the UserProvider contract, asks
 * the token repository to create/check/delete tokens, delegates mailing to
 * the model's CanResetPassword surface, and hashes the new password with
 * the application hasher. Controllers stay thin: they validate input,
 * call one broker method and turn the returned status into a response.
 *
 * Statuses follow Laravel's convention - the string constants below - so
 * callers can compare against `PasswordBroker.INVALID_USER` and friends
 * instead of parsing prose.
 *
 * @example
 * ```typescript
 * const status = await broker.sendResetLink({ email: 'ada@example.com' });
 * // PasswordBroker.RESET_LINK_SENT | INVALID_USER | RESET_THROTTLED
 *
 * const result = await broker.reset({ email, token, password });
 * // PasswordBroker.PASSWORD_RESET | INVALID_USER | INVALID_TOKEN
 * ```
 */

import { randomBytes } from 'crypto';
import type { Authenticatable } from '@/Auth/Contracts/Authenticatable';
import type { CanResetPassword } from '@/Auth/Contracts/CanResetPassword';
import type { AuthCredentials, UserProvider } from '@/Auth/Contracts/UserProvider';
import type { Hasher } from '@/Hashing/Contracts/Hasher';
import type { PasswordResetTokenRepository } from './Contracts/PasswordResetTokenRepository';

/**
 * A broker-retrieved user that also speaks the reset contract. Providers
 * hand out Authenticatable users; the reset flow additionally needs the
 * CanResetPassword surface, enforced at the call sites with clear errors.
 */
export type BrokerUser = Authenticatable & CanResetPassword;

/**
 * The instance operations the broker performs after a successful reset;
 * Ensemble + HasAuthenticatable models satisfy it (same shape the user
 * provider persists with).
 */
export interface ResettableInstance extends BrokerUser {
  setAttribute(key: string, value: any): unknown;
  save(): Promise<unknown> | unknown;
}

/**
 * One broker outcome: either a status constant or the resolved user.
 */
export type PasswordBrokerStatus = string;

/**
 * Hook invoked with the user and the plain-text password between token
 * validation and persistence - Laravel's `reset($credentials, $callback)`.
 */
export type ResetCallback = (user: ResettableInstance, password: string) => void | Promise<void>;

export class PasswordBroker {
  /**
   * A reset link was mailed (Laravel: 'passwords.sent')
   */
  static readonly RESET_LINK_SENT = 'passwords.sent';

  /**
   * The password was reset (Laravel: 'passwords.reset')
   */
  static readonly PASSWORD_RESET = 'passwords.reset';

  /**
   * No user matches the credentials
   */
  static readonly INVALID_USER = 'invalid-user';

  /**
   * The token is missing, wrong, expired or already used
   */
  static readonly INVALID_TOKEN = 'invalid-token';

  /**
   * A link was sent too recently; ask the user to check their inbox or wait
   * (Laravel: 'passwords.throttled')
   */
  static readonly RESET_THROTTLED = 'passwords.throttled';

  constructor(
    protected readonly users: UserProvider,
    protected readonly tokens: PasswordResetTokenRepository,
    protected readonly hasher: Hasher
  ) {}

  /**
   * Send a password reset link to the address in the credentials.
   *
   * Unknown addresses answer INVALID_USER without touching the mailer, and
   * an address with a token younger than the throttle window is answered
   * RESET_THROTTLED - the one-link-per-minute Laravel enforces before it
   * would generate a second link.
   * Laravel: PasswordBroker::sendResetLink()
   */
  async sendResetLink(credentials: AuthCredentials): Promise<PasswordBrokerStatus> {
    const user = await this.getUser(credentials);

    if (!user) {
      return PasswordBroker.INVALID_USER;
    }

    if (await this.tokens.recentlyCreatedToken(user)) {
      return PasswordBroker.RESET_THROTTLED;
    }

    const record = await this.tokens.create(user);

    await this.sendResetLinkEmail(user, record.plainTextToken);

    return PasswordBroker.RESET_LINK_SENT;
  }

  /**
   * Reset the password of the credentials' user, running the optional
   * Laravel-style callback before persisting the hashed password, rotating
   * the remember token and invalidating the stored reset token.
   * Laravel: PasswordBroker::reset()
   */
  async reset(credentials: AuthCredentials, callback?: ResetCallback): Promise<PasswordBrokerStatus> {
    const user = await this.getUser(credentials);

    if (!user) {
      return PasswordBroker.INVALID_USER;
    }

    const token = credentials.token === undefined || credentials.token === null ? '' : String(credentials.token);

    if (!(await this.tokens.exists(user, token))) {
      return PasswordBroker.INVALID_TOKEN;
    }

    const password = String(credentials.password ?? '');
    const instance = this.requireInstance(user);

    if (callback) {
      await callback(instance, password);
    }

    await this.resetPassword(instance, password);

    return PasswordBroker.PASSWORD_RESET;
  }

  /**
   * Determine whether the credentials carry a user whose stored token
   * matches. `true` on success; INVALID_USER / INVALID_TOKEN otherwise, so
   * callers can distinguish "no such account" from "bad link".
   * Laravel: PasswordBroker::validateToken()
   */
  async validateToken(credentials: AuthCredentials): Promise<true | PasswordBrokerStatus> {
    const user = await this.getUser(credentials);

    if (!user) {
      return PasswordBroker.INVALID_USER;
    }

    const token = credentials.token === undefined || credentials.token === null ? '' : String(credentials.token);

    return (await this.tokens.exists(user, token)) ? true : PasswordBroker.INVALID_TOKEN;
  }

  /**
   * Drop every stored token for the credentials' user without resetting
   * anything (revoke flow).
   * Laravel: PasswordBroker::deleteToken()
   */
  async deleteToken(credentials: AuthCredentials): Promise<void> {
    const user = await this.getUser(credentials);

    if (user) {
      await this.tokens.delete(user);
    }
  }

  /**
   * Look the credentials' user up through the provider. The reset `token`
   * is stripped first (Laravel does the same): providers match user rows on
   * identity columns only, and the token belongs to the repository.
   */
  protected async getUser(credentials: AuthCredentials): Promise<BrokerUser | null> {
    const { token: _ignored, ...identity } = credentials;

    return (await this.users.retrieveByCredentials(identity)) as BrokerUser | null;
  }

  /**
   * Hand the raw token to the model's CanResetPassword surface; the model
   * decides how it becomes mail (Laravel: sendPasswordResetNotification).
   */
  protected async sendResetLinkEmail(user: BrokerUser, token: string): Promise<void> {
    if (
      typeof user.getEmailForPasswordReset !== 'function' ||
      typeof user.sendPasswordResetNotification !== 'function'
    ) {
      throw new Error(
        'Users must implement the CanResetPassword contract (the CanResetPassword concern on the model) ' +
          'to receive password reset links.'
      );
    }

    await user.sendPasswordResetNotification(token);
  }

  /**
   * Persist the new hashed password, rotate the remember token, invalidate
   * the stored reset token. Laravel: PasswordBroker::resetPassword()
   */
  protected async resetPassword(user: ResettableInstance, password: string): Promise<void> {
    user.setAttribute(user.getAuthPasswordName(), this.hasher.make(password));
    user.setRememberToken(this.newRememberToken());

    await user.save();

    await this.tokens.delete(user);
  }

  /**
   * A fresh remember-me token; Laravel rotates these on password change so
   * every other device logs out.
   */
  protected newRememberToken(): string {
    return randomBytes(30).toString('base64url');
  }

  /**
   * Guard that a broker-retrieved user really is persistable, the same
   * check the ensemble user provider applies.
   */
  protected requireInstance(user: BrokerUser | null): ResettableInstance {
    if (!user) {
      throw new Error('Password reset needs a user; this should not happen after a successful validation.');
    }

    const instance = user as Partial<ResettableInstance>;

    if (typeof instance.setAttribute !== 'function' || typeof instance.save !== 'function') {
      throw new Error(
        'Users must be persistable model instances (Ensemble + HasAuthenticatable shapes) to reset their ' +
          `password through the broker [got ${user.constructor?.name ?? 'object'}].`
      );
    }

    return instance as ResettableInstance;
  }
}
