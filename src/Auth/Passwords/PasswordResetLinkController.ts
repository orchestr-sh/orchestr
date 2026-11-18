/**
 * PasswordResetLinkController - `password.email` endpoint
 *
 * The Laravel Breeze equivalent: validate the address, ask the broker for
 * a link, turn the broker status into a response. All token work -
 * creation, hashing, throttling, mailing - stays inside the broker and
 * its repository (SRP); nothing but glue lives here.
 */

import type { Request } from '@/Routing/Request';
import type { ResponseObject } from '@/Routing/Responses';
import { Controller } from '@/Routing/Controller';
import { password } from '@/Support/helpers';
import { refererOf, respondWithOutcome, sendLinkOutcome } from './statusResponse';

export class PasswordResetLinkController extends Controller {
  /**
   * Send a password reset link to the given user.
   * Laravel: PasswordResetLinkController::store()
   */
  async store(request: Request): Promise<ResponseObject> {
    const { email } = await request.validate({ email: 'required|email' });

    const status = await password().sendResetLink({ email });

    return respondWithOutcome(request, sendLinkOutcome(status), refererOf(request) ?? '/');
  }
}
