/**
 * Response - the allow/deny verdict of an authorization check, carrying an
 * optional failure message and HTTP status
 * Laravel: Illuminate\Auth\Access\Response
 *
 * Ability callbacks and policy methods may return plain booleans (converted
 * to allow/deny responses by the Gate) or build a Response directly to
 * attach a message (`Response.deny('Only authors may edit posts.')`) and a
 * custom status. `authorize()` converts a denial into the
 * AuthorizationException the exception handler renders as a 403.
 */

import { AuthorizationException } from './AuthorizationException';

export class Response {
  /**
   * Whether the action is authorized
   * Laravel: $response->allowed
   */
  public readonly allowed: boolean;

  /**
   * The failure message shown when the response denies the action
   */
  private failureMessage: string | null;

  /**
   * A custom HTTP status for the denial (defaulting to the handler's 403)
   */
  private failureStatus: number | null;

  constructor(allowed: boolean, message: string | null = null, status: number | null = null) {
    this.allowed = allowed;
    this.failureMessage = message;
    this.failureStatus = status;

    // Keep instanceof working when the output is down-levelled
    Object.setPrototypeOf(this, Response.prototype);
  }

  /**
   * Create an allowed response, optionally carrying a message
   * Laravel: Response::allow()
   */
  static allow(message: string | null = null): Response {
    return new Response(true, message);
  }

  /**
   * Create a denied response, optionally carrying a message and status
   * Laravel: Response::deny()
   */
  static deny(message: string | null = null, status: number | null = null): Response {
    return new Response(false, message, status);
  }

  /**
   * Normalise the raw result of an ability callback, before/after callback
   * or policy method into a Response: booleans become allow/deny, strings
   * become denials carrying that message, Responses pass through, and any
   * other falsy value denies with the default message
   */
  static from(result: boolean | string | Response | null | undefined): Response {
    if (result instanceof Response) {
      return result;
    }

    if (typeof result === 'string') {
      return Response.deny(result);
    }

    return result ? Response.allow() : Response.deny();
  }

  /**
   * The message accompanying a denial (or an allow created with one)
   * Laravel: $response->message()
   */
  message(): string | null {
    return this.failureMessage;
  }

  /**
   * The custom HTTP status accompanying a denial, when one was set
   * Laravel: $response->status()
   */
  status(): number | null {
    return this.failureStatus;
  }

  /**
   * The exception this denial renders into
   * Laravel: $response->toException()
   */
  toException(): AuthorizationException {
    return new AuthorizationException(this.failureMessage, this.failureStatus);
  }

  /**
   * Return the response when it allows the action, throwing the matching
   * AuthorizationException when it denies
   * Laravel: $response->authorize()
   */
  authorize(): this {
    if (!this.allowed) {
      throw this.toException();
    }

    return this;
  }
}
