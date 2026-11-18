/**
 * TimeoutException
 *
 * A ConnectionException specialised for time budget expiry - the
 * request exceeded its `timeout()` or `connectTimeout()` and the client
 * aborted it. Mirrors the Illuminate\Http\Client timeout family so
 * applications can catch `TimeoutException` alone or any of its
 * supertypes.
 */

import { ConnectionException } from './ConnectionException';

export class TimeoutException extends ConnectionException {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);

    this.name = 'TimeoutException';
  }
}
