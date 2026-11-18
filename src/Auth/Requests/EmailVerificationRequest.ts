/**
 * EmailVerificationRequest - validates a signed verification link
 *
 * The Laravel counterpart (`Illuminate\Auth\Requests\EmailVerification-
 * Request`): given the `{id}`/`{hash}` segments of the `verification.verify`
 * route, it retrieves the user through the configured provider, compares
 * the hash against sha1 of the user's current email address (so a link
 * dies the moment the address changes) and knows how to mark the address
 * verified. The HMAC of the signed URL was already validated by the
 * `signed` middleware; this request validates the *route* payload - the
 * same two-layer check Laravel applies (DRY: neither the controller nor
 * the middleware repeats it).
 */

import { createHash, timingSafeEqual } from 'crypto';
import type { AuthManager } from '@/Auth/AuthManager';
import type { Authenticatable } from '@/Auth/Contracts/Authenticatable';
import type { MustVerifyEmail } from '@/Auth/Contracts/MustVerifyEmail';
import type { UserProvider } from '@/Auth/Contracts/UserProvider';
import { abort } from '@/Foundation/Exceptions/abort';
import { FormRequest } from '@/Foundation/Http/FormRequest';
import { getGlobalApp } from '@/Support/helpers';

/**
 * A user the verification flow can work with: identity plus the
 * MustVerifyEmail surface.
 */
export type VerifiableUser = Authenticatable & MustVerifyEmail;

/**
 * Resolve the user provider verification addresses users through: the
 * `auth.verification.provider` name on the container-bound AuthManager.
 */
export function resolveVerificationProvider(): UserProvider {
  const app = getGlobalApp();

  if (!app || !app.bound('auth')) {
    throw new Error(
      'Email verification needs the AuthServiceProvider (it resolves the user provider through the ' +
        "'auth' manager)."
    );
  }

  const manager = app.make<AuthManager>('auth');

  const name = manager.config.verification?.provider ?? 'users';

  return manager.provider(name);
}

export class EmailVerificationRequest extends FormRequest {
  /**
   * Memoised route user, once verified
   */
  private verifiable: VerifiableUser | null = null;

  /**
   * The payload lives in route segments that the signed URL already covers
   * (and the `signed` middleware already checked); presence is enforced by
   * resolveUser so a missing segment answers 403 like a bad signature.
   * Laravel: EmailVerificationRequest::rules()
   */
  protected rules(): Record<string, any> {
    return {};
  }

  /**
   * Retrieve and validate the route's user: exists, speaks the
   * MustVerifyEmail contract, and the `hash` segment matches sha1 of the
   * user's email address. Every failure is an invalid signature.
   * Laravel: EmailVerificationRequest::user() / InvalidSignatureException
   */
  async resolveUser(): Promise<VerifiableUser> {
    if (this.verifiable) {
      return this.verifiable;
    }

    const id = this.routeParam('id');
    const hash = this.routeParam('hash');

    if (id === undefined || id === null || typeof hash !== 'string' || hash === '') {
      abort(403, 'Invalid signature.');
    }

    const user = (await resolveVerificationProvider().retrieveById(id)) as VerifiableUser | null;

    if (!user) {
      abort(403, 'Invalid signature.');
    }

    if (typeof user.getEmailForVerification !== 'function' || typeof user.markEmailAsVerified !== 'function') {
      throw new Error(
        'Users must implement the MustVerifyEmail contract (the HasVerifiedEmail concern on the model) ' +
          'to verify their email address.'
      );
    }

    const expected = createHash('sha1').update(user.getEmailForVerification()).digest('hex');
    const presented = Buffer.from(hash);
    const wanted = Buffer.from(expected);

    if (presented.length !== wanted.length || !timingSafeEqual(presented, wanted)) {
      abort(403, 'Invalid signature.');
    }

    this.verifiable = user;

    return user;
  }

  /**
   * Mark the route's email address verified (persisting through the model,
   * no-op for addresses already verified).
   * Laravel: EmailVerificationRequest::markAsVerified()
   */
  async markAsVerified(): Promise<boolean> {
    const user = await this.resolveUser();

    if (await user.hasVerifiedEmail()) {
      return true;
    }

    return Boolean(await user.markEmailAsVerified());
  }
}
