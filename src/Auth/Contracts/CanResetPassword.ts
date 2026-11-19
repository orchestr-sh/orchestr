/**
 * CanResetPassword Contract
 *
 * The surface a user model must expose for the password broker to send it a
 * reset link: where the reset mail goes and how the reset notification is
 * delivered. Mirrors Illuminate\Contracts\Auth\CanResetPassword; models gain
 * the methods through the CanResetPassword concern, exactly like Laravel's
 * `use Illuminate\Auth\Passwords\CanResetPassword` trait on the User model.
 */

import type { Authenticatable } from './Authenticatable';

export interface CanResetPassword {
  /**
   * The address the reset link is sent to
   * Laravel: CanResetPassword::getEmailForPasswordReset()
   */
  getEmailForPasswordReset(): string;

  /**
   * Deliver the reset notification carrying the (raw) reset token
   * Laravel: CanResetPassword::sendPasswordResetNotification($token)
   */
  sendPasswordResetNotification(token: string): void | Promise<void>;
}

/**
 * A broker-capable user: an authenticatable identity that can also receive
 * reset links. The broker retrieves Authenticatable users through the
 * provider contract and speaks to them through this one.
 */
export type PasswordResettable = Authenticatable & CanResetPassword;
