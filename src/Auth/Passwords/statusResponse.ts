/**
 * Broker status responses - the thin controllers' shared reply layer
 *
 * The password controllers differ only in which broker call they make and
 * which status they celebrate; turning a broker status into the Laravel
 * answer (422 with a field error, 429 when throttled, JSON for requests
 * that expect it, redirect-back with flashed status/errors otherwise)
 * belongs to exactly one place (DRY). Message wording follows Laravel's
 * built-in `lang/en/passwords.php` lines so app templates see the familiar
 * strings.
 */

import type { Request } from '@/Routing/Request';
import type { ResponseObject } from '@/Routing/Responses';
import { PasswordBroker } from '@/Auth/Passwords/PasswordBroker';
import { JsonResponse, RedirectResponse } from '@/Routing/Responses';

/**
 * Laravel: lang/en/passwords.php
 */
export const PASSWORD_MESSAGES = {
  sent: 'We have emailed your password reset link.',
  reset: 'Your password has been reset.',
  throttled: 'Too many password reset requests. Please wait and try again.',
  user: "We can't find a user with that email address.",
  token: 'This password reset token is invalid.',
};

/**
 * The outcome of one broker call, already interpreted.
 */
export interface BrokerOutcome {
  /** HTTP status to answer with */
  status: number;
  /** Human message (JSON body, flashed status or flashed error) */
  message: string;
  /** Validation field the failure belongs to; absent for successes */
  field?: string;
}

/**
 * Interpret one broker status for the `sendResetLink` flow.
 */
export function sendLinkOutcome(status: string): BrokerOutcome {
  switch (status) {
    case PasswordBroker.RESET_LINK_SENT:
      return { status: 200, message: PASSWORD_MESSAGES.sent };
    case PasswordBroker.RESET_THROTTLED:
      return { status: 429, message: PASSWORD_MESSAGES.throttled, field: 'email' };
    default:
      return { status: 422, message: PASSWORD_MESSAGES.user, field: 'email' };
  }
}

/**
 * Interpret one broker status for the `reset` flow.
 */
export function resetOutcome(status: string): BrokerOutcome {
  switch (status) {
    case PasswordBroker.PASSWORD_RESET:
      return { status: 200, message: PASSWORD_MESSAGES.reset };
    case PasswordBroker.INVALID_USER:
      return { status: 422, message: PASSWORD_MESSAGES.user, field: 'email' };
    default:
      return { status: 422, message: PASSWORD_MESSAGES.token, field: 'token' };
  }
}

/**
 * Answer a broker outcome the way Laravel's Breeze controllers do:
 *
 * - JSON requests get the message (plus `errors` for failures) with the
 *   outcome status;
 * - HTML successes redirect to `successRedirect` (Laravel: `->with('status', ...)`)
 *   with the status flashed into the session when one is running;
 * - HTML failures redirect back to the form (Laravel: `->withInput()->withErrors`)
 *   with the error flashed under its field.
 */
export function respondWithOutcome(request: Request, outcome: BrokerOutcome, successRedirect: string): ResponseObject {
  const failure = outcome.status !== 200;

  if (request.expectsJson()) {
    const body: Record<string, any> = { message: outcome.message };

    if (failure && outcome.field) {
      body.errors = { [outcome.field]: [outcome.message] };
    }

    return new JsonResponse(body, outcome.status);
  }

  const store = request.hasSession() ? request.session() : null;

  if (failure) {
    if (store && outcome.field) {
      store.flash('errors', { [outcome.field]: [outcome.message] });
    }

    return new RedirectResponse(refererOf(request) ?? '/');
  }

  if (store) {
    store.flash('status', outcome.message);
  }

  return new RedirectResponse(successRedirect);
}

/**
 * Laravel's `back()` starting point: the referring URL when the browser
 * carried one.
 */
export function refererOf(request: Request): string | null {
  const referer = request.header('referer') ?? request.header('referrer');

  return typeof referer === 'string' && referer !== '' ? referer : null;
}
