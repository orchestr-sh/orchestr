/**
 * RateLimiter - the cache-backed counting service
 *
 * Exercises the limiter over a plain array-store repository: hit windows,
 * decay, remaining/retryAfter accounting, clear, the attempt flow, bound
 * for() handles and the named-limiter registry.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request } from '@/Routing/Request';
import { Limited, RateLimiter } from '@/Cache/RateLimiter';
import { Limit } from '@/Cache/RateLimiting/Limit';
import { Unlimited } from '@/Cache/RateLimiting/Unlimited';
import { Repository } from '@/Cache/Repository';
import { ArrayStore } from '@/Cache/Stores/ArrayStore';

function makeLimiter(): RateLimiter {
  return new RateLimiter(new Repository(new ArrayStore({ serialize: false }, 'limiter_test:')));
}

describe('RateLimiter', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = makeLimiter();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('hit / attempts / remaining', () => {
    it('counts hits against the key and reports the window as open early on', async () => {
      expect(await limiter.hit('post:1', 5)).toBe(false);
      expect(await limiter.hit('post:1', 5)).toBe(false);
      expect(await limiter.attempts('post:1')).toBe(2);
      expect(await limiter.remaining('post:1', 5)).toBe(3);
    });

    it('reports the window exhausted once the limit is reached', async () => {
      await limiter.hit('post:1', 2);

      expect(await limiter.hit('post:1', 2)).toBe(true);
      expect(await limiter.tooManyAttempts('post:1', 2)).toBe(true);
      expect(await limiter.remaining('post:1', 2)).toBe(0);
    });

    it('never reports negative remaining for over-shot keys', async () => {
      await limiter.hit('post:1', 1);
      await limiter.hit('post:1', 1);

      expect(await limiter.remaining('post:1', 1)).toBe(0);
    });

    it('keys are independent windows', async () => {
      await limiter.hit('a', 1);
      await limiter.hit('a', 1);

      expect(await limiter.tooManyAttempts('b', 1)).toBe(false);
    });
  });

  describe('decay', () => {
    it('releases the key once the window has passed', async () => {
      const start = new Date();
      vi.useFakeTimers({ now: start });

      await limiter.hit('sms:1', 2, 10);
      await limiter.hit('sms:1', 2, 10);

      expect(await limiter.tooManyAttempts('sms:1', 2)).toBe(true);

      vi.setSystemTime(new Date(start.getTime() + 11_000));

      expect(await limiter.tooManyAttempts('sms:1', 2)).toBe(false);
      expect(await limiter.attempts('sms:1')).toBe(0);
    });

    it('keeps the original window open when hits keep arriving', async () => {
      const start = new Date();
      vi.useFakeTimers({ now: start });

      await limiter.hit('sms:1', 5, 30);

      vi.setSystemTime(new Date(start.getTime() + 20_000));
      await limiter.hit('sms:1', 5, 30);

      // 10 seconds left, not 30: the second hit did not restart the timer
      expect(await limiter.availableIn('sms:1')).toBe(10);
    });
  });

  describe('retryAfter / availableIn', () => {
    it('counts down the seconds until the key is usable again', async () => {
      vi.useFakeTimers({ now: new Date() });

      await limiter.hit('sms:1', 1, 60);

      expect(await limiter.availableIn('sms:1')).toBe(60);
      expect(await limiter.retryAfter('sms:1')).toBe(await limiter.availableIn('sms:1'));
    });

    it('is zero for keys with no open window', async () => {
      expect(await limiter.availableIn('never-hit')).toBe(0);
    });
  });

  describe('clear', () => {
    it('forgets the counter and the window timer', async () => {
      await limiter.hit('sms:1', 1, 60);

      await limiter.clear('sms:1');

      expect(await limiter.attempts('sms:1')).toBe(0);
      expect(await limiter.availableIn('sms:1')).toBe(0);
      expect(await limiter.tooManyAttempts('sms:1', 1)).toBe(false);
    });
  });

  describe('attempt', () => {
    it('runs the callback and counts the hit while the window allows it', async () => {
      const result = await limiter.attempt('job:1', 2, () => 'sent');

      expect(result).toBe('sent');
      expect(await limiter.attempts('job:1')).toBe(1);
    });

    it('answers false without running the callback once the key is exhausted', async () => {
      await limiter.hit('job:1', 1, 60);

      let ran = false;

      expect(await limiter.attempt('job:1', 1, () => void (ran = true))).toBe(false);
      expect(ran).toBe(false);
    });

    it('treats an undefined callback result as success', async () => {
      expect(await limiter.attempt('job:1', 2, () => undefined)).toBe(true);
    });
  });

  describe('for()', () => {
    it('binds a counting handle to the key, max and window', async () => {
      vi.useFakeTimers({ now: new Date() });

      const handle = limiter.for('api:1', 2, 45);

      expect(handle).toBeInstanceOf(Limited);
      expect(handle.key).toBe('api:1');
      expect(handle.maxAttempts).toBe(2);
      expect(handle.decaySeconds).toBe(45);

      expect(await handle.hit()).toBe(false);
      expect(await handle.remaining()).toBe(1);
      expect(await handle.hit()).toBe(true);
      expect(await handle.tooManyAttempts()).toBe(true);
      expect(await handle.retryAfter()).toBe(45);

      await handle.clear();

      expect(await handle.attempts()).toBe(0);
    });

    it('defaults the window to one minute', () => {
      expect(limiter.for('api:1', 60).decaySeconds).toBe(60);
    });
  });

  describe('named limiters', () => {
    it('defines, finds and resolves limiters by name', async () => {
      const callback = () => Limit.perMinute(30);

      limiter.define('api', callback);

      expect(limiter.has('api')).toBe(true);
      expect(limiter.limiter('api')).toBe(callback);

      const resolved = await limiter.resolve('api', {} as Request);

      expect(resolved).toBeInstanceOf(Limit);
      expect((resolved as Limit).maxAttempts).toBe(30);
    });

    it('forgets named limiters', () => {
      limiter.define('api', () => Limit.perMinute(30));

      expect(limiter.forget('api')).toBe(true);
      expect(limiter.has('api')).toBe(false);
    });

    it('rejects resolving an unknown name', async () => {
      await expect(limiter.resolve('ghost', {} as Request)).rejects.toThrow(/not defined/);
    });
  });

  describe('Limit definitions', () => {
    it('factories carry the documented windows', () => {
      expect(Limit.perSecond(5)).toMatchObject({ maxAttempts: 5, decaySeconds: 1 });
      expect(Limit.perFiveSeconds(5)).toMatchObject({ maxAttempts: 5, decaySeconds: 5 });
      expect(Limit.perTenSeconds(5)).toMatchObject({ maxAttempts: 5, decaySeconds: 10 });
      expect(Limit.perThirtySeconds(5)).toMatchObject({ maxAttempts: 5, decaySeconds: 30 });
      expect(Limit.perMinute(60)).toMatchObject({ maxAttempts: 60, decaySeconds: 60 });
      expect(Limit.perHour(500)).toMatchObject({ maxAttempts: 500, decaySeconds: 3600 });
      expect(Limit.perDay(100)).toMatchObject({ maxAttempts: 100, decaySeconds: 86400 });
    });

    it('keys limits from a literal or a request resolver', async () => {
      const request = { ip: () => '10.0.0.1' } as unknown as Request;

      expect(await Limit.perMinute(1).by('static-key').resolveKey(request)).toBe('static-key');
      expect(
        await Limit.perMinute(1)
          .by((req) => req.ip() ?? '')
          .resolveKey(request)
      ).toBe('10.0.0.1');
      expect(await Limit.perMinute(1).resolveKey(request)).toBeUndefined();
    });

    it('carries custom messages and responses', () => {
      const responder = () => {
        throw new Error('called');
      };
      const limit = Limit.perMinute(1).messages('Slow down.').response(responder);

      expect(limit.message).toBe('Slow down.');
      expect(limit.responseCallback).toBe(responder);
    });
  });

  describe('Unlimited', () => {
    it('resolves as an exemption marker only when it carries a truthy value', () => {
      expect(Unlimited.resolves(new Unlimited())).toBe(true);
      expect(Unlimited.resolves(new Unlimited(false))).toBe(false);
      expect(Unlimited.resolves(Limit.perMinute(1))).toBe(false);
      expect(Unlimited.resolves(undefined)).toBe(false);
    });
  });
});
