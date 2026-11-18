/**
 * HasVerifiedEmail Concern
 *
 * The port of Laravel's `Illuminate\Auth\MustVerifyEmail` trait (named for
 * what it gives the model, keeping the contract name free): the email
 * address for verification, the verified check against the
 * `email_verified_at` column, marking the address verified, and delivering
 * the VerifyEmail notification.
 *
 * @example
 * ```typescript
 * class User extends HasVerifiedEmail(CanResetPassword(HasAuthenticatable(Ensemble))) {
 *   static fillable = ['name', 'email', 'password'];
 *
 *   getTable(): string {
 *     return 'users';
 *   }
 * }
 * ```
 *
 * Models composed with the `Notifiable` concern deliver through it; without
 * it the concern routes straight to the application's notification router
 * (same fallback as the CanResetPassword concern, DRY).
 */

import type { AttributeCarrier, ModelConstructor } from '@/Auth/Concerns/HasAuthenticatable';
import type { Authenticatable } from '@/Auth/Contracts/Authenticatable';
import type { MustVerifyEmail } from '@/Auth/Contracts/MustVerifyEmail';
import { VerifyEmail } from '@/Auth/Notifications/VerifyEmail';
import { resolveNotificationRouter } from '@/Notifications/Notifiable';

/**
 * The instance surface this concern builds on: attributes plus persistence,
 * which Ensemble models already carry.
 */
export interface VerifiableCarrier extends AttributeCarrier {
  save(): Promise<unknown> | unknown;
}

/**
 * The concern surface instances carry at runtime
 */
export interface VerifiedEmailMethods extends MustVerifyEmail {}

/**
 * The instance type the mixin produces
 */
export type VerifiedEmailInstance = VerifiableCarrier & Authenticatable & VerifiedEmailMethods;

export function HasVerifiedEmail<T extends ModelConstructor<VerifiableCarrier>>(
  Base: T
): T & ModelConstructor<VerifiedEmailInstance> {
  abstract class HasVerifiedEmailMixin extends Base implements MustVerifyEmail {
    /**
     * The column holding the verification timestamp
     * Laravel: the `email_verified_at` column the trait writes through forceFill
     */
    protected verifiedEmailColumn: string = 'email_verified_at';

    /**
     * The column name the verification timestamp lives in
     */
    getVerifiedEmailColumnName(): string {
      return this.verifiedEmailColumn;
    }

    /**
     * The address a verification link is sent to
     * Laravel: MustVerifyEmail::getEmailForVerification()
     */
    getEmailForVerification(): string {
      const email = this.getAttribute('email');

      if (email === undefined || email === null || email === '') {
        throw new Error(
          'This user has no email address. Email verification needs the `email` column (or override ' +
            'getEmailForVerification()).'
        );
      }

      return String(email);
    }

    /**
     * Whether the address already carries a verification timestamp
     * Laravel: MustVerifyEmail::hasVerifiedEmail()
     */
    hasVerifiedEmail(): boolean {
      const verifiedAt = this.getAttribute(this.verifiedEmailColumn);

      return verifiedAt !== null && verifiedAt !== undefined && verifiedAt !== false && verifiedAt !== '';
    }

    /**
     * Stamp and persist the verification timestamp. Re-stamping an already
     * verified address is a no-op, like Laravel's guard in the trait.
     * Laravel: MustVerifyEmail::markEmailAsVerified()
     */
    async markEmailAsVerified(): Promise<boolean> {
      if (this.hasVerifiedEmail()) {
        return true;
      }

      this.setAttribute(this.verifiedEmailColumn, new Date().toISOString());

      return Boolean(await this.save());
    }

    /**
     * Deliver the verification notification.
     * Laravel: MustVerifyEmail::sendEmailVerificationNotification()
     */
    async sendEmailVerificationNotification(): Promise<void> {
      const notification = new VerifyEmail();

      const self = this as unknown as { notify?: (notification: unknown) => Promise<void> };

      if (typeof self.notify === 'function') {
        await self.notify(notification);

        return;
      }

      await resolveNotificationRouter().send(this, notification);
    }
  }

  return HasVerifiedEmailMixin as unknown as T & ModelConstructor<VerifiedEmailInstance>;
}
