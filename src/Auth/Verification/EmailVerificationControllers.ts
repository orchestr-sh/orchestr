/**
 * The three email-verification endpoints, Laravel 12's Fortify shape:
 *
 * - EmailVerificationPromptController      GET  /email/verify
 *     The "please verify" notice: verified visitors move on, everyone
 *     else gets the notice (202 for both JSON and HTML).
 * - EmailVerificationNotificationController POST /email/verification-notification
 *     Resends the verification mail; verified users are bounced to the
 *     home path so a stale tab cannot keep mailing. The route helper
 *     wraps this with auth + throttle, one burst per minute like Laravel.
 * - VerifyEmailController                  GET  /email/verify/:id/:hash
 *     Marks the address verified through EmailVerificationRequest and
 *     redirects home (JSON message for API clients).
 *
 * Each class is glue: user lookup, hashing and persistence stay in the
 * request/concern layer (SRP), and all three share one "verified?" helper
 * so the answer never diverges (DRY).
 */

import type { MustVerifyEmail } from '@/Auth/Contracts/MustVerifyEmail';
import type { Request } from '@/Routing/Request';
import { refererOf } from '@/Auth/Passwords/statusResponse';
import { EmailVerificationRequest } from '@/Auth/Requests/EmailVerificationRequest';
import { Controller } from '@/Routing/Controller';
import { JsonResponse, RedirectResponse, ResponseObject } from '@/Routing/Responses';

/**
 * Where the verification endpoints send visitors who have nothing left to
 * verify (the "home" path; Laravel's RouteServiceProvider::HOME default).
 */
export interface VerificationControllerOptions {
  redirectTo?: string;
}

/**
 * Whether any user (or guest) counts as verified - one place decides,
 * so the three endpoints cannot disagree. Duck-typed: the guard hands
 * out Authenticatable users, and the HasVerifiedEmail concern (or any
 * MustVerifyEmail implementation) adds the answer here.
 */
async function isVerified(user: unknown): Promise<boolean> {
  const candidate = user as Partial<MustVerifyEmail> | null | undefined;

  if (!candidate || typeof candidate.hasVerifiedEmail !== 'function') {
    return false;
  }

  return Boolean(await candidate.hasVerifiedEmail());
}

/**
 * The notice text: Laravel's verification view heading, spelled for the
 * JSON/HTML fallbacks the framework ships.
 */
export const VERIFICATION_NOTICE_MESSAGE = 'Please verify your email address.';

/**
 * GET /email/verify - the "we sent a link, click it" notice.
 * Laravel: EmailVerificationPromptController (Fortify)
 */
export class EmailVerificationPromptController extends Controller {
  constructor(protected readonly options: VerificationControllerOptions = {}) {
    super();
  }

  /**
   * Redirect verified visitors to `redirectTo` (default '/'); everybody
   * else gets the notice.
   */
  async show(request: Request): Promise<ResponseObject> {
    const user = await request.user();

    if (await isVerified(user)) {
      return new RedirectResponse(this.options.redirectTo ?? '/');
    }

    if (request.expectsJson()) {
      return new JsonResponse({ message: VERIFICATION_NOTICE_MESSAGE }, 202);
    }

    return new ResponseObject(VERIFICATION_NOTICE_MESSAGE, 202, { 'Content-Type': 'text/html' });
  }
}

/**
 * POST /email/verification-notification - resend the verification mail.
 * Laravel: EmailVerificationNotificationController (Fortify)
 */
export class EmailVerificationNotificationController extends Controller {
  constructor(protected readonly options: VerificationControllerOptions = {}) {
    super();
  }

  /**
   * Send a fresh verification notification to the authenticated user.
   */
  async store(request: Request): Promise<ResponseObject> {
    const user = (await request.user()) as Partial<MustVerifyEmail> | null;

    if (!user) {
      return new JsonResponse({ message: 'Unauthenticated.' }, 401);
    }

    if (await isVerified(user)) {
      if (request.expectsJson()) {
        return new JsonResponse({ message: 'Your email address is already verified.' }, 200);
      }

      return new RedirectResponse(this.options.redirectTo ?? '/');
    }

    if (typeof user.sendEmailVerificationNotification !== 'function') {
      throw new Error(
        'Users must implement the MustVerifyEmail contract (the HasVerifiedEmail concern on the model) ' +
          'to receive verification notifications.'
      );
    }

    await user.sendEmailVerificationNotification();

    const status = 'verification-link-sent';
    const message = 'A new verification link has been sent to your email address.';

    if (request.expectsJson()) {
      return new JsonResponse({ status, message }, 200);
    }

    const store = request.hasSession() ? request.session() : null;

    if (store) {
      store.flash('status', { [status]: message });
    }

    return new RedirectResponse(refererOf(request) ?? this.options.redirectTo ?? '/');
  }
}

/**
 * GET /email/verify/:id/:hash - consume a signed verification link.
 * Laravel: VerifyEmailController (Fortify) / the EmailVerificationRequest closure
 */
export class VerifyEmailController extends Controller {
  constructor(protected readonly options: VerificationControllerOptions = {}) {
    super();
  }

  /**
   * Mark the addressed email verified (the request validates the id/hash
   * pair; the signature layer ran in the `signed` middleware) and answer
   * per the Fortify conventions.
   * Laravel: VerifyEmailController::__invoke()
   */
  async verify(request: Request): Promise<ResponseObject> {
    const verification = await EmailVerificationRequest.validate(request);

    await verification.markAsVerified();

    if (request.expectsJson()) {
      return new JsonResponse({ message: 'Your email address has been verified.' }, 200);
    }

    return new RedirectResponse(this.options.redirectTo ?? '/');
  }
}
