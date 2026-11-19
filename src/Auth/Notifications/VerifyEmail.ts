/**
 * VerifyEmail - the notification behind an email-verification link.
 *
 * The Laravel counterpart (`Illuminate\Auth\Notifications\VerifyEmail`)
 * mails the notifiable a temporary signed URL to the `verification.verify`
 * route, addressed by the user's id and the sha1 hash of the email (so the
 * link stops working once the address changes). Orchestr signs the same
 * route with the same parameters; the window comes from
 * `auth.verification.expire`.
 *
 * @example
 * ```typescript
 * // Sent for you by the HasVerifiedEmail concern; build the mail directly
 * // when customising the flow:
 * const mail = new VerifyEmail().toMail(user);
 * ```
 */

import { createHash } from 'crypto';
import type { Authenticatable } from '@/Auth/Contracts/Authenticatable';
import type { MustVerifyEmail } from '@/Auth/Contracts/MustVerifyEmail';
import { Notification } from '@/Notifications/Notification';
import { AuthenticationMail } from './AuthenticationMail';
import { signedUrlFor, verificationLinkExpirationMinutes } from './signedUrl';

/**
 * The hash Laravel compares against the `{hash}` route segment:
 * sha1 of the address being verified.
 */
export function emailVerificationHash(email: string): string {
  return createHash('sha1').update(email).digest('hex');
}

export class VerifyEmail extends Notification {
  /**
   * The subject of the verification mail. Laravel: `__('Verify Your Email Address')`
   */
  static subject: string = 'Verify Your Email Address';

  /**
   * The mail representation: the signed `verification.verify` URL with the
   * user's id and the email hash as route parameters.
   * Laravel: VerifyEmail::toMail()
   */
  toMail(notifiable: Authenticatable & MustVerifyEmail): AuthenticationMail {
    return new AuthenticationMail({
      subject: VerifyEmail.subject,
      intro: 'Please verify your email address by clicking the button below.',
      actionLabel: 'Verify Email Address',
      url: this.verificationUrl(notifiable),
      outro: 'If you did not create an account, no further action is required.',
    });
  }

  /**
   * The signed verification URL: `verification.verify` addressed by id and
   * email hash, valid for the `auth.verification.expire` window.
   */
  verificationUrl(notifiable: Authenticatable & MustVerifyEmail): string {
    return signedUrlFor(
      'verification.verify',
      { id: notifiable.getAuthIdentifier(), hash: emailVerificationHash(notifiable.getEmailForVerification()) },
      verificationLinkExpirationMinutes()
    );
  }
}
