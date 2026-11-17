/**
 * HTTP client - retries, timeouts, and error exceptions
 *
 * The retry loop, the timeout budget, and the throw rules all live in
 * PendingRequest (one place, DRY); these pin their Laravel semantics:
 * retry(3, 100) attempts three times total, throwIf/retryWhen steer the
 * escalation, and connection failures surface as ConnectionException
 * (TimeoutException for budget expiry).
 */

import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import { Http } from '@/Facades/Http';
import { ConnectionException } from '@/Http/Client/ConnectionException';
import { RequestException } from '@/Http/Client/RequestException';
import { TimeoutException } from '@/Http/Client/TimeoutException';
import { HttpTestServer } from './support';

afterEach(() => {
  Http.stopFaking();
});

describe('retry', () => {
  it('acceptance: retry(3, 100) retries failures and succeeds on a later attempt', async () => {
    Http.fake({
      'https://flaky.test/*': Http.sequence([
        Http.response('boom', 500),
        Http.response('still boom', 500),
        Http.response({ result: 'ok' }, 200),
      ]),
    });

    const response = await Http.retry(3, 100).get('https://flaky.test/job');

    expect(response.successful()).toBe(true);
    expect(response.json('result')).toBe('ok');
    Http.assertSentCount(3);
  });

  it('throws a RequestException once the attempts run out', async () => {
    Http.fake({ '*': Http.response('nope', 503) });

    await expect(Http.retry(2, 1).get('https://down.test/')).rejects.toBeInstanceOf(RequestException);

    Http.assertSentCount(2);
  });

  it('retryThrow=false hands back the last failed response instead', async () => {
    Http.fake({ '*': Http.response('nope', 503) });

    const response = await Http.retry(2, 1, undefined, false).get('https://down.test/');

    expect(response.status()).toBe(503);
    expect(response.failed()).toBe(true);
    Http.assertSentCount(2);
  });

  it('retryWhen decides which failures are worth another attempt', async () => {
    Http.fake({ '*': Http.response('nope', 500) });

    const seen: unknown[] = [];

    await expect(
      Http.retry(3, 1, (exception) => {
        seen.push(exception);

        return false;
      }).get('https://stubborn.test/')
    ).rejects.toBeInstanceOf(RequestException);

    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeInstanceOf(RequestException);
    Http.assertSentCount(1);
  });

  it('backs off exponentially via a delay closure and an array schedule', async () => {
    const timestamps: number[] = [];

    Http.fake(() => {
      timestamps.push(Date.now());

      return Http.response('busy', 429);
    });

    const started = Date.now();

    await expect(Http.retry(3, (attempt) => attempt * 20).get('https://slow.test/')).rejects.toBeInstanceOf(
      RequestException
    );

    expect(timestamps).toHaveLength(3);
    expect(Date.now() - started).toBeGreaterThanOrEqual(60);
    expect(timestamps[1] - timestamps[0]).toBeGreaterThanOrEqual(15);
    expect(timestamps[2] - timestamps[1]).toBeGreaterThanOrEqual(35);

    timestamps.length = 0;

    // The array form schedules per-attempt delays (count + 1 attempts).
    await expect(Http.retry([10, 30]).get('https://slow.test/')).rejects.toBeInstanceOf(RequestException);

    expect(timestamps).toHaveLength(3);
  });

  it('retries connection failures and surfaces the final exception', async () => {
    let attempts = 0;

    Http.fake(() => {
      attempts += 1;

      if (attempts < 3) {
        throw new ConnectionException('ECONNREFUSED');
      }

      return { connected: true };
    });

    const response = await Http.retry(3, 1).get('https://flaky-connection.test/');

    expect(response.json('connected')).toBe(true);
    expect(attempts).toBe(3);
    Http.assertSentCount(3);
  });
});

describe('timeouts and transport errors', () => {
  let server: HttpTestServer;

  beforeEach(async () => {
    server = new HttpTestServer();
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  it('raises a TimeoutException when the budget expires', async () => {
    server.responder = (_request, res) => {
      setTimeout(() => {
        res.writeHead(200);
        res.end('eventually');
      }, 200);
    };

    await expect(Http.timeout(0.02).get(server.url('/slow'))).rejects.toBeInstanceOf(TimeoutException);
  });

  it('raises a TimeoutException when the connection never completes', async () => {
    server.responder = () => {
      // Accept the socket, answer nothing: connect timeout territory.
    };

    await expect(Http.connectTimeout(0.03).get(server.url('/hang'))).rejects.toBeInstanceOf(TimeoutException);
  });

  it('wraps unreachable hosts in ConnectionException', async () => {
    const closed = new HttpTestServer();

    await closed.start();
    const dead = closed.url('/');
    await closed.stop();

    await expect(Http.get(dead)).rejects.toBeInstanceOf(ConnectionException);
  });

  it('TimeoutException is catchable as its Laravel supertypes', async () => {
    server.responder = () => {};

    const error = await Http.timeout(0.02)
      .connectTimeout(0.02)
      .get(server.url('/never'))
      .catch((reason) => reason);

    expect(error).toBeInstanceOf(TimeoutException);
    expect(error).toBeInstanceOf(ConnectionException);
    expect(error).toBeInstanceOf(RequestException);
  });
});

describe('error escalation', () => {
  it('acceptance: throw() raises on 4xx/5xx and leaves success alone', async () => {
    Http.fake({
      'https://errors.test/404': Http.response({ message: 'not found' }, 404),
      'https://errors.test/500': Http.response('kaboom', 500),
      'https://errors.test/200': Http.response({ fine: true }),
    });

    await expect(Http.get('https://errors.test/404').then((response) => response.throw())).rejects.toBeInstanceOf(
      RequestException
    );

    await expect(Http.get('https://errors.test/500').then((response) => response.throw())).rejects.toBeInstanceOf(
      RequestException
    );

    const fine = await Http.get('https://errors.test/200');

    expect(fine.throw()).toBe(fine);
  });

  it('the RequestException message summarizes the failed response', async () => {
    Http.fake({ '*': Http.response({ message: 'validation failed' }, 422) });

    const response = await Http.get('https://errors.test/submit');

    expect(() => response.throw()).toThrow(/HTTP request returned status code 422/);
    expect(() => response.throw()).toThrow(/validation failed/);
  });

  it('the throw callback transforms escalation, Laravel style', async () => {
    Http.fake({ '*': Http.response('no', 500) });

    const response = await Http.get('https://errors.test/hard');

    expect(() => response.throw(() => {})).toThrow(RequestException);

    expect(() =>
      response.throw(() => {
        throw new Error('custom failure');
      })
    ).toThrow('custom failure');
  });

  it('Http.throw()/throwIf() escalate failed sends at the request level', async () => {
    Http.fake({
      'https://guards.test/404': Http.response('missing', 404),
      'https://guards.test/500': Http.response('broken', 500),
    });

    await expect(Http.throw().get('https://guards.test/404')).rejects.toBeInstanceOf(RequestException);

    const skipped = await Http.throwIf((response) => response.status() === 500).get('https://guards.test/404');

    expect(skipped.status()).toBe(404);

    await expect(
      Http.throwIf((response) => response.status() === 500).get('https://guards.test/500')
    ).rejects.toBeInstanceOf(RequestException);

    const alsoSkipped = await Http.throwIf(false).get('https://guards.test/404');

    expect(alsoSkipped.status()).toBe(404);
  });

  it('a bare failed response is returned, not thrown, like Laravel', async () => {
    Http.fake({ '*': Http.response('nope', 500) });

    const response = await Http.get('https://plain.test/');

    expect(response.serverError()).toBe(true);
  });

  it('onError runs only for failed responses', async () => {
    Http.fake({ '*': Http.response('nope', 500) });

    const seen: number[] = [];

    const response = await Http.get('https://plain.test/');

    response.onError((r) => seen.push(r.status()));

    expect(seen).toEqual([500]);
  });
});
