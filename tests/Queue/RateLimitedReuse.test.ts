/**
 * RateLimited job middleware - reuse of the shared RateLimiter service
 *
 * The queue-side middleware counts through the same cache-backed limiter
 * the HTTP throttle uses (DRY): with an application running it resolves
 * the container's 'limiter', so a key hit by a route is already spent for
 * a job, and vice versa. Without an application it falls back to a private
 * process-local limiter.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import type { CacheManager } from '@/Cache/CacheManager';
import { CacheServiceProvider } from '@/Cache/CacheServiceProvider';
import { RateLimiter } from '@/Cache/RateLimiter';
import { RateLimiterServiceProvider } from '@/Cache/RateLimiterServiceProvider';
import { Application } from '@/Foundation/Application';
import { Config } from '@/Foundation/Config/Config';
import { Job } from '@/Queue/Job';
import { RateLimited } from '@/Queue/Middleware/RateLimited';
import { getGlobalApp } from '@/Support/helpers';

class NoopJob extends Job {
  async handle(): Promise<void> {
    // no-op
  }
}

async function runJob(middleware: RateLimited, job: Job): Promise<void> {
  await middleware.handle(job, async () => undefined);
}

describe('RateLimited queue middleware', () => {
  beforeEach(async () => {
    const app = new Application('/test');

    app.instance('config', new Config({ cache: { default: 'array', stores: { array: { driver: 'array' } } } }));
    app.register(CacheServiceProvider);
    app.register(RateLimiterServiceProvider);

    await app.boot();
  });

  it('releases the job with the window reset once the limit is spent', async () => {
    const middleware = new RateLimited('podcasts', 2, 45);

    const first = new NoopJob();
    const second = new NoopJob();
    const third = new NoopJob();

    await runJob(middleware, first);
    await runJob(middleware, second);
    await runJob(middleware, third);

    expect(first.isReleased()).toBe(false);
    expect(second.isReleased()).toBe(false);
    expect(third.isReleased()).toBe(true);
    // The job is held for the rest of the open window
    expect(third.getReleaseDelay()).toBeGreaterThan(0);
    expect(third.getReleaseDelay()).toBeLessThanOrEqual(45);
  });

  it('honours an explicit releaseAfter over the window timer', async () => {
    const middleware = new RateLimited('podcasts', 1, 45).releaseAfter(5);

    await runJob(middleware, new NoopJob());

    const blocked = new NoopJob();
    await runJob(middleware, blocked);

    expect(blocked.isReleased()).toBe(true);
    expect(blocked.getReleaseDelay()).toBe(5);
  });

  it('shares the bucket with the container limiter used by HTTP throttling', async () => {
    const limiter = getLimiter();

    await limiter.hit('shared-key', 2, 60);

    const job = new NoopJob();

    await runJob(new RateLimited('shared-key', 2, 60), job);

    // Second hit done by the job: the window is now exhausted...
    expect(job.isReleased()).toBe(false);

    const blocked = new NoopJob();

    await runJob(new RateLimited('shared-key', 2, 60), blocked);

    expect(blocked.isReleased()).toBe(true);

    // ...and the HTTP side sees the same state
    expect(await limiter.tooManyAttempts('shared-key', 2)).toBe(true);
  });

  it('keeps a private process-local limiter when the app has no limiter binding', async () => {
    // An application without RateLimiterServiceProvider: the middleware
    // must count on its own fallback limiter, never the app cache
    const app = new Application('/test');

    app.instance('config', new Config({ cache: { default: 'array', stores: { array: { driver: 'array' } } } }));
    app.register(CacheServiceProvider);

    await app.boot();

    const middleware = new RateLimited('standalone', 1, 60);

    await runJob(middleware, new NoopJob());

    const blocked = new NoopJob();

    await runJob(middleware, blocked);

    expect(blocked.isReleased()).toBe(true);

    // The fallback store is isolated from the application's cache
    const cache = app.make<CacheManager>('cache').store();

    expect(await cache.get('orchestr_rate_limiter:standalone')).toBeNull();
  });
});

/**
 * The current application's limiter (each test installs a fresh one)
 */
function getLimiter(): RateLimiter {
  const app = getGlobalApp();

  if (!app) {
    throw new Error('Test expected a global application instance.');
  }

  return app.make<RateLimiter>('limiter');
}
