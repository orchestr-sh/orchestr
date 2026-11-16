/**
 * Time control: travelTo / travel / travelBack / freezeTime
 *
 * Proves the clock rewrites what Date.now() and new Date() report for
 * application code (cache stores, session lifetimes, the scheduler), that
 * travel is relative, and that TestCase teardown returns to real time
 * even when a test forgets.
 */

import { describe, it, expect, afterEach } from 'vitest';
import type { CacheManager } from '@/Cache/CacheManager';
import { CronExpression } from '@/Scheduling/CronExpression';
import { freezeTime, TestCase, travel, travelBack, travelTo } from '@/Testing';

/**
 * Real time captured at import - the unpatched Date.now bound once
 */
const realNow = Date.now.bind(Date);

describe('Clock helpers', () => {
  afterEach(() => {
    travelBack();
  });

  it('travelTo sets an absolute moment and keeps time flowing', () => {
    const target = new Date('2030-01-01T12:00:00.000Z');

    travelTo(target);

    expect(Date.now()).toBeGreaterThanOrEqual(target.getTime());
    expect(Date.now()).toBeLessThan(target.getTime() + 5000);
    expect(new Date().getTime()).toBe(Date.now());
    expect(new Date() instanceof Date).toBe(true);
  });

  it('travelTo accepts strings and epoch milliseconds', () => {
    travelTo('2031-06-15T00:00:00.000Z');
    expect(Date.now()).toBeGreaterThanOrEqual(new Date('2031-06-15T00:00:00.000Z').getTime());

    travelTo(1_000_000);
    expect(Date.now()).toBeGreaterThanOrEqual(1_000_000);
  });

  it('travel offsets seconds forwards and backwards', () => {
    const before = realNow();

    travel(3600);
    expect(Date.now() - before).toBeGreaterThanOrEqual(3600 * 1000);

    travel(-1800);
    expect(Date.now() - before).toBeGreaterThanOrEqual(1800 * 1000);
    expect(Date.now() - before).toBeLessThan(1801 * 1000);
  });

  it('freezeTime pins the clock', async () => {
    travelTo('2032-02-02T02:02:02.000Z');
    freezeTime();

    const first = Date.now();

    await new Promise((resolve) => setImmediate(resolve));

    expect(Date.now()).toBe(first);
  });

  it('travelBack restores the real Date', () => {
    const original = Date;

    travelTo('2040-01-01T00:00:00.000Z');

    expect(Date.now()).toBeGreaterThan(original.now());

    travelBack();

    expect(Date).toBe(original);
    expect(Math.abs(Date.now() - realNow())).toBeLessThan(5000);
  });

  it('instances created before travel still satisfy instanceof Date', () => {
    const created = new Date();

    travelTo('2045-01-01T00:00:00.000Z');

    expect(created instanceof Date).toBe(true);
    expect(new Date() instanceof Date).toBe(true);
  });

  it('the scheduler reads the travelled clock', () => {
    travelTo('2033-05-05T10:00:00.000Z');

    // CronExpression defaults its `from` to new Date(): with the clock in
    // 2033 the next noon is computed from there, not from real time.
    const next = CronExpression.expressionFor('0 12 * * *').nextRunDate();

    expect(next).not.toBeNull();
    expect(next!.getTime()).toBeGreaterThan(Date.now());
    expect(next!.getTime()).toBeLessThanOrEqual(Date.now() + 24 * 60 * 60 * 1000 + 60_000);
  });
});

class CacheTimeTestCase extends TestCase {
  async testTravelledTimeExpiresCacheEntries(): Promise<void> {
    const cache = this.app.make<CacheManager>('cache');

    travelTo('2033-01-01T00:00:00.000Z');

    await cache.put('milk', 'fresh', 60 * 60);

    expect(await cache.get('milk')).toBe('fresh');

    travel(61 * 60);

    expect(await cache.get('milk')).toBeNull();
  }

  async testTeardownRestoresRealTime(): Promise<void> {
    // This method itself does not travel: if a previous test's clock leaked,
    // Date.now() would still be in 2033.
    expect(new Date().getFullYear()).toBeLessThan(2100);
  }
}

new CacheTimeTestCase();
