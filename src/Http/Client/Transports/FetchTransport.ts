/**
 * FetchTransport - the default Transport, built on Node's built-in
 * fetch (Node 22+).
 *
 * The contract speaks plain data, so this adapter is thin: it maps a
 * TransportRequest onto fetch's init, enforces the connect-timeout
 * budget (the point at which response headers must have arrived),
 * forwards the client's abort signal (the overall timeout), and folds
 * the finished response into a TransportResponse with a buffered body.
 *
 * Network-level failures surface as ConnectionException - the same
 * shape Laravel's client reports for Guzzle's ConnectException - and
 * the client's own timeout (an aborted signal carrying a
 * TimeoutException reason) is re-thrown verbatim.
 */

import type { Transport, TransportRequest, TransportResponse } from '../Contracts/Transport';
import { ConnectionException } from '../ConnectionException';
import { RequestException } from '../RequestException';
import { TimeoutException } from '../TimeoutException';

export class FetchTransport implements Transport {
  /**
   * An optional fetch implementation, injected for exotic adapters
   * and tests; by default the global fetch is read per call so
   * test-time interceptions (HttpFake, Http.fake() of other tooling)
   * still apply.
   */
  constructor(protected fetchImpl?: typeof globalThis.fetch) {}

  async send(request: TransportRequest): Promise<TransportResponse> {
    const fetchFn = this.fetchImpl ?? globalThis.fetch;

    if (typeof fetchFn !== 'function') {
      throw new ConnectionException('The fetch transport requires a fetch implementation (Node 22+).');
    }

    const controller = new AbortController();

    const connectMs = request.connectTimeout ? Math.max(0, request.connectTimeout * 1000) : 0;

    const connectTimer = connectMs
      ? setTimeout(
          () =>
            controller.abort(
              new TimeoutException(`Connection to [${hostOf(request.url)}] timed out after ${connectMs}ms.`)
            ),
          connectMs
        )
      : undefined;

    const external = request.signal;

    if (external) {
      if (external.aborted) {
        controller.abort(external.reason);
      } else {
        external.addEventListener('abort', () => controller.abort(external.reason), { once: true });
      }
    }

    try {
      const response = await fetchFn(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body === null ? undefined : request.body,
        signal: controller.signal,
        ...(request.options ?? {}),
      });

      // Headers are in; the connect budget has done its job.
      if (connectTimer !== undefined) {
        clearTimeout(connectTimer);
      }

      return {
        status: response.status,
        headers: collectHeaders(response.headers),
        body: new Uint8Array(await response.arrayBuffer()),
      };
    } catch (error) {
      // Our own exceptions (client timeout reasons, connect timeouts)
      // travel unchanged; the client recognises them.
      if (error instanceof RequestException) {
        throw error;
      }

      throw new ConnectionException(
        `Could not connect to [${request.method} ${request.url}]: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    } finally {
      if (connectTimer !== undefined) {
        clearTimeout(connectTimer);
      }
    }
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Fold a fetch Headers object into a plain lower-cased record, joining
 * repeated values the way HTTP itself does.
 */
function collectHeaders(headers: globalThis.Headers): Record<string, string> {
  const collected: Record<string, string> = {};

  headers.forEach((value, name) => {
    collected[name] = collected[name] === undefined ? value : `${collected[name]}, ${value}`;
  });

  return collected;
}
