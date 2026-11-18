/**
 * NewPasswordController - `password.update` endpoint
 *
 * The Laravel Breeze controller equivalent: validate the token + new
 * password coming off the reset form, hand them to the broker and answer
 * with the broker's status. Token validation, expiry and invalidation all
 * live in the broker and the token repository (SRP) - this class only
 * glues the HTTP surface to them, plus the optional Laravel-style reset
 * callback apps can pass to the broker itself.
 */

import type { Request } from '@/Routing/Request';
import type { ResponseObject } from '@/Routing/Responses';
import { Controller } from '@/Routing/Controller';
import { password } from '@/Support/helpers';
import { refererOf, respondWithOutcome, resetOutcome } from './statusResponse';

export class NewPasswordController extends Controller {
  /**
   * Handle a password reset form submission.
   * Laravel: NewPasswordController::store()
   */
  async store(request: Request): Promise<ResponseObject> {
    const data = await request.validate({
      token: 'required',
      email: 'required|email',
      password: 'required|confirmed',
    });

    const status = await password().reset(data);

    return respondWithOutcome(request, resetOutcome(status), refererOf(request) ?? '/');
  }
}
