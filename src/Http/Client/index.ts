/**
 * Orchestr's Laravel-shaped HTTP client (Illuminate\Http\Client).
 *
 * - Factory / PendingRequest: the fluent `Http.*` API, verbs included.
 * - Response: status/json/collect/throw over buffered responses.
 * - Exceptions: ConnectionException, RequestException, TimeoutException.
 * - Contracts/Transport: the adapter seam (FetchTransport is default).
 * - fake()/stubs/sequences/assertions: Laravel-style outbound faking.
 */

export { Factory, defaultFactory } from './Factory';
export type { FakeStubMap, RecordedMatcher, RequestResponsePair } from './Factory';
export { PendingRequest } from './PendingRequest';
export type {
  BeforeSendingCallback,
  RetryDelay,
  RetryWhenCallback,
  StubCallback,
  StubValue,
  ThrowCallback,
  ThrowIfCallback,
} from './PendingRequest';
export { Request } from './Request';
export type { RequestFile } from './Request';
export { Response } from './Response';
export type { ResponseHeaderBag, ResponseOptions } from './Response';
export { Sequence } from './Sequence';
export { ConnectionException } from './ConnectionException';
export { RequestException, REQUEST_EXCEPTION_SUMMARY_LENGTH } from './RequestException';
export { TimeoutException } from './TimeoutException';
export { FetchTransport } from './Transports/FetchTransport';
export { HttpServiceProvider } from './HttpServiceProvider';
export type { Transport, TransportRequest, TransportResponse } from './Contracts/Transport';
