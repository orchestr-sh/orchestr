/**
 * HasPasswordReset Concern
 *
 * The port of Laravel's `Illuminate\Auth\Passwords\CanResetPassword` trait
 * (named Has*-style to keep the `CanResetPassword` contract name free, like
 * HasAuthenticatable does for Authenticatable): gives an attribute-carrying
 * model the contract the password broker reads - where the reset mail goes
 * and how the `ResetPassword` notification is delivered.
 *
 * @example
 * ```typescript
 * class User extends HasPasswordReset(HasVerifiedEmail(HasAuthenticatable(Ensemble))) {
 *   static fillable = ['name', 'email', 'password'];
 *
 *   getTable(): string {
 *     return 'users';
 *   }
 * }
 * ```
 *
 * Models composed with the `Notifiable` concern deliver through it (queue
 * markers included); without it the concern routes straight to the
 * application's notification router so the broker keeps working.
 */

import type { AttributeCarrier, ModelConstructor } from '@/Auth/Concerns/HasAuthenticatable';
import type { Authenticatable } from '@/Auth/Contracts/Authenticatable';
import type { CanResetPassword as CanResetPasswordContract } from '@/Auth/Contracts/CanResetPassword';
import { ResetPassword } from '@/Auth/Notifications/ResetPassword';
import { resolveNotificationRouter } from '@/Notifications/Notifiable';

/**
 * The concern surface instances carry at runtime
 */
export interface PasswordResetMethods extends CanResetPasswordContract {}

/**
 * The instance type the mixin produces
 */
export type PasswordResettableInstance = AttributeCarrier & Authenticatable & PasswordResetMethods;

export function HasPasswordReset<T extends ModelConstructor>(
  Base: T
): T & ModelConstructor<PasswordResettableInstance> {
  abstract class HasPasswordResetMixin extends Base implements CanResetPasswordContract {
    /**
     * The column holding the address reset links go to
     * Laravel: the `email` property read by CanResetPassword::getEmailForPasswordReset()
     */
    protected resetPasswordEmailColumn: string = 'email';

    /**
     * The address the broker mails a reset link to
     * Laravel: CanResetPassword::getEmailForPasswordReset()
     */
    getEmailForPasswordReset(): string {
      const email = this.getAttribute(this.resetPasswordEmailColumn);

      if (email === undefined || email === null || email === '') {
        throw new Error(
          'This user has no email address. The password broker needs the `email` column (or override ' +
            'getEmailForPasswordReset()) to send reset links.'
        );
      }

      return String(email);
    }

    /**
     * Deliver the reset notification carrying the raw token.
     * Laravel: CanResetPassword::sendPasswordResetNotification($token)
     */
    async sendPasswordResetNotification(token: string): Promise<void> {
      const notification = new ResetPassword(token);

      // Models composed with Notifiable already know how to route
      // notifications (queue markers included); anything else goes straight
      // to the application's notification router (DRY with the trait's
      // `$this->notify(...)` call).
      const self = this as unknown as { notify?: (notification: unknown) => Promise<void> };

      if (typeof self.notify === 'function') {
        await self.notify(notification);

        return;
      }

      await resolveNotificationRouter().send(this, notification);
    }
  }

  return HasPasswordResetMixin as unknown as T & ModelConstructor<PasswordResettableInstance>;
}
