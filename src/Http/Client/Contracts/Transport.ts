/**
 * Transport contract
 *
 * The single seam between the HTTP client and the outside world (OCP):
 * PendingRequest builds a fully-resolved TransportRequest - absolute URL,
 * final headers, encoded body, timeout budget - and hands it to a
 * Transport. The fluent API never touches `fetch` (or any other client)
 * directly; swapping in a proxy, a mock or a different HTTP library is a
 * `Http.setTransport()` call, not a code change.
 *
 * The contract deliberately speaks in plain data (method, url, headers,
 * string-or-bytes body) rather than fetch/RequestInit internals, so
 * adapters stay independent of both the client and each other.
 */

/**
 * A fully built outbound request, as handed to a Transport.
 */
export interface TransportRequest {
  /** HTTP verb, upper-cased */
  method: string;

  /** Absolute URL, query string included */
  url: string;

  /**
   * Final request headers, keyed by lower-cased name. Auth headers
   * (Basic / Bearer / Cookie) have already been merged in.
   */
  headers: Record<string, string>;

  /**
   * Encoded request body, or null when the request has none. Multipart
   * bodies arrive pre-encoded (with the boundary already reflected in
   * the `content-type` header), so transports never see FormData.
   */
  body: string | Uint8Array | null;

  /** Overall timeout in seconds, when configured */
  timeout?: number;

  /** Connect timeout in seconds, when configured */
  connectTimeout?: number;

  /**
   * Abort signal fired by the client when the timeout budget expires;
   * transports should forward it to their underlying request so the
   * in-flight call is cancelled.
   */
  signal?: AbortSignal;

  /**
   * Extra transport-specific options from `withOptions()` (e.g. fetch
   * init keys like `redirect` or `keepalive`). Adapters pick what they
   * understand and ignore the rest.
   */
  options: Record<string, any>;
}

/**
 * The raw response a Transport reports back - status, lower-cased
 * headers, and the body already buffered as bytes.
 */
export interface TransportResponse {
  status: number;

  /** Response headers, keyed by lower-cased name */
  headers: Record<string, string>;

  /** Buffered response body */
  body: Uint8Array;
}

/**
 * Transport contract. Implementations send the request as given and
 * return the raw response; retries, timeouts and error mapping for a
 * failure the transport itself observed (connection refused, DNS) are
 * the transport's business only insofar as it reports them as a
 * ConnectionException (or rejects with an error the client wraps).
 */
export interface Transport {
  send(request: TransportRequest): Promise<TransportResponse>;
}
