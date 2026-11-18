/**
 * ConnectionException
 *
 * Raised when a request never made it to - or back from - the server:
 * DNS failure, refused connection, aborted transfer. It extends
 * RequestException (mirroring Illuminate\Http\Client\ConnectionException)
 * but carries no meaningful response, since there was none.
 */

import { RequestException } from './RequestException';
import { Response } from './Response';

export class ConnectionException extends RequestException {
  constructor(message: string, options?: { cause?: unknown }) {
    super(new Response('', 0), message);

    this.name = 'ConnectionException';

    if (options && 'cause' in options) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }

  /**
   * Connection failures have no response to speak of.
   * Laravel: ConnectionException::hasResponse()
   */
  hasResponse(): boolean {
    return false;
  }
}
