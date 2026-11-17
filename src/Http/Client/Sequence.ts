/**
 * Sequence - an ordered script of stub responses.
 *
 * Mirrors Illuminate\Http\Client\ResponseSequence: push canned
 * responses onto it, use it as a fake stub, and each request pops the
 * next response off the front. Useful for flaky-endpoint tests:
 *
 * @example
 * ```typescript
 * const seq = Http.fakeSequence('https://api.example.com/*');
 * seq.pushStatus(500).push({ retry: true }).push({ data: [1, 2] });
 * ```
 */

import { readFileSync } from 'fs';
import type { StubValue } from './PendingRequest';
import type { Request } from './Request';
import type { ResponseHeaderBag } from './Response';
import { ConnectionException } from './ConnectionException';
import { Response } from './Response';

export class Sequence {
  /**
   * The queued responses, consumed front-first
   */
  protected responses: StubValue[];

  /**
   * Whether an emptied sequence throws instead of answering a default
   */
  protected failWhenEmpty: boolean = true;

  /**
   * The answer given once the sequence is empty, when not failing
   */
  protected emptyResponse?: StubValue;

  constructor(responses: StubValue[] = []) {
    this.responses = [...responses];
  }

  /**
   * Push a canned response: object bodies are JSON, everything else
   * arrives as text.
   * Laravel: ResponseSequence::push()
   */
  push(body: any = null, status: number = 200, headers: ResponseHeaderBag = {}): this {
    return this.pushResponse(Response.make(body, status, headers));
  }

  /**
   * Push a status-only response with an empty body.
   * Laravel: ResponseSequence::pushStatus()
   */
  pushStatus(status: number, headers: ResponseHeaderBag = {}): this {
    return this.pushResponse(Response.make('', status, headers));
  }

  /**
   * Push a response whose body is the contents of a local file.
   * Laravel: ResponseSequence::pushFile()
   */
  pushFile(filePath: string, status: number = 200, headers: ResponseHeaderBag = {}): this {
    return this.pushResponse(Response.make(readFileSync(filePath, 'utf8'), status, headers));
  }

  /**
   * Push a raw stub value - a Response, a JSON body, a status code, a
   * callback, or even an exception to throw.
   * Laravel: ResponseSequence::pushResponse()
   */
  pushResponse(response: StubValue): this {
    this.responses.push(response);

    return this;
  }

  /**
   * Push a connection failure: the next request through this sequence
   * rejects with a ConnectionException.
   * Laravel: ResponseSequence::pushFailedConnection()
   */
  pushFailedConnection(message?: string): this {
    return this.pushResponse(() => {
      throw new ConnectionException(message ?? 'Could not resolve host.');
    });
  }

  /**
   * Answer with a default instead of failing once emptied.
   * Laravel: ResponseSequence::whenEmpty()
   */
  whenEmpty(response: StubValue): this {
    this.failWhenEmpty = false;
    this.emptyResponse = response;

    return this;
  }

  /**
   * Answer empty requests with a plain 200 instead of failing.
   * Laravel: ResponseSequence::dontFailWhenEmpty()
   */
  dontFailWhenEmpty(): this {
    return this.whenEmpty(Response.make());
  }

  /**
   * Whether the sequence has run out of queued responses.
   * Laravel: ResponseSequence::isEmpty()
   */
  isEmpty(): boolean {
    return this.responses.length === 0;
  }

  /**
   * Pop the next response for the given request.
   * Laravel: ResponseSequence::__invoke()
   */
  next(request?: Request): StubValue {
    if (this.isEmpty()) {
      if (this.failWhenEmpty) {
        throw new Error('A request was made, but the response sequence is empty.');
      }

      return this.emptyResponse ?? Response.make();
    }

    const response = this.responses.shift() as StubValue;

    return typeof response === 'function' ? (response as (request?: Request) => StubValue)(request) : response;
  }
}
