/**
 * MustVerifyEmail Contract
 *
 * The surface a user model must expose for the email-verification flow: the
 * address being verified, whether it already was, and how to mark it (or
 * notify about it). Mirrors Illuminate\Contracts\Auth\MustVerifyEmail; models
 * gain the methods through the HasVerifiedEmail concern, exactly like
 * Laravel's `use Illuminate\Auth\MustVerifyEmail` trait on the User model.
 */
import type { Authenticatable } from './Authenticatable';

export interface MustVerifyEmail {
  /**
   * The address a verification link is sent to
   * Laravel: MustVerifyEmail::getEmailForVerification()
   */
  getEmailForVerification(): string;

  /**
   * Whether the address already carries a verification timestamp
   * Laravel: MustVerifyEmail::hasVerifiedEmail()
   */
  hasVerifiedEmail(): boolean | Promise<boolean>;

  /**
   * Stamp the address as verified (persisting is the model's job)
   * Laravel: MustVerifyEmail::markEmailAsVerified()
   */
  markEmailAsVerified(): boolean | Promise<boolean>;

  /**
   * Deliver the verification notification
   * Laravel: MustVerifyEmail::sendEmailVerificationNotification()
   */
  sendEmailVerificationNotification(): void | Promise<void>;
}

/**
 * A verifiable user: an authenticatable identity the 'verified' middleware
 * and the verification routes can talk to.
 */
export type Verifiable = Authenticatable & MustVerifyEmail;
