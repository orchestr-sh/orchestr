/**
 * ResetPassword - the notification behind a password-reset link.
 *
 * The Laravel counterpart (`Illuminate\Auth\Notifications\ResetPassword`)
 * mails the notifiable a link to the `password.reset` route carrying the
 * broker's token; here that link is additionally *signed* (the ticket's
 * "Mail notification with a signed reset URL"), so tampered or swapped
 * query parameters are rejected by the signature before the token is ever
 * looked up. The validity window matches the broker's `expire` config so
 * link and stored token expire together (DRY).
 *
 * @example
 * ```typescript
 * // Sent for you by the CanResetPassword concern when the broker creates
 * // a token; build the mail directly when customising the flow:
 * const mail = new ResetPassword(token).toMail(user);
 * ```
 */

import type { CanResetPassword } from '@/Auth/Contracts/CanResetPassword';
import { Notification } from '@/Notifications/Notification';
import { AuthenticationMail } from './AuthenticationMail';
import { resetLinkExpirationMinutes, signedUrlFor } from './signedUrl';

export class ResetPassword extends Notification {
  /**
   * The subject of the reset mail. Laravel: `__('Reset Password Notification')`
   */
  static subject: string = 'Reset Password Notification';

  constructor(public readonly token: string) {
    super();
  }

  /**
   * The mail representation: the signed `password.reset` URL addressed to
   * the user's reset email.
   * Laravel: ResetPassword::toMail()
   */
  toMail(notifiable: CanResetPassword): AuthenticationMail {
    return new AuthenticationMail({
      subject: ResetPassword.subject,
      intro: 'You are receiving this email because we received a password reset request for your account.',
      actionLabel: 'Reset Password',
      url: this.resetUrl(notifiable),
      outro: 'If you did not request a password reset, no further action is required.',
    });
  }

  /**
   * The signed reset URL: `password.reset` with the token in the path and
   * the address in the query string, valid for the broker's expire window.
   */
  resetUrl(notifiable: CanResetPassword): string {
    return signedUrlFor(
      'password.reset',
      { token: this.token, email: notifiable.getEmailForPasswordReset() },
      resetLinkExpirationMinutes()
    );
  }
}
