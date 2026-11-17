/**
 * RequestException
 *
 * Raised when a request completes with a 4xx/5xx response and the
 * application asked for escalation - `response.throw()`,
 * `Http.throw()`, `Http.throwIf(...)`, or the retry pipeline exhausting
 * its attempts with throwing enabled. Mirrors
 * Illuminate\Http\Client\RequestException: the exception carries the
 * Response it describes and formats the standard "HTTP request returned
 * status code N" message, summarising (and truncating) the body the way
 * Guzzle's message formatter does.
 */

import type { Request } from './Request';
import type { Response } from './Response';

/**
 * Default length at which response bodies are summarised in messages,
 * matching Guzzle's `Message::bodySummary` default.
 */
export const REQUEST_EXCEPTION_SUMMARY_LENGTH = 120;

export class RequestException extends Error {
  /**
   * The failed response, when the exception came from one (connection
   * exceptions carry none).
   */
  public readonly response: Response;

  /**
   * The outbound request that produced this failure, when known.
   */
  public request?: Request;

  constructor(response: Response, message?: string) {
    super(message ?? RequestException.buildMessage(response));

    this.name = 'RequestException';
    this.response = response;

    // Preserve the prototype chain when instances are created through
    // subclasses (ConnectionException, TimeoutException).
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /**
   * The response this exception describes.
   * Laravel: RequestException::getResponse()
   */
  getResponse(): Response {
    return this.response;
  }

  /**
   * Whether a response backs this exception.
   * Laravel: RequestException::hasResponse()
   */
  hasResponse(): boolean {
    return this.response !== undefined && this.response !== null;
  }

  /**
   * "HTTP request returned status code 404" plus a one-line summary of
   * the response body, Guzzle style.
   */
  protected static buildMessage(response: Response): string {
    const message = `HTTP request returned status code ${response.status()}`;

    const summary = response.text().replace(/\s+/g, ' ').trim();

    if (!summary) {
      return message;
    }

    const truncated =
      summary.length > REQUEST_EXCEPTION_SUMMARY_LENGTH
        ? `${summary.slice(0, REQUEST_EXCEPTION_SUMMARY_LENGTH)}...`
        : summary;

    return `${message}: ${truncated}`;
  }
}
