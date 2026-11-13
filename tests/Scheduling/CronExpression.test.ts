/**
 * CronExpression tests
 *
 * Covers the acceptance-critical shapes (every-minute, every-five-minutes
 * step, `0 9 * * 1-5`, `0 0 1 * *`, and `0 0 * * 0`), lists/ranges/steps,
 * month and day names, Sunday as 0/7, POSIX dom/dow semantics, timezone
 * evaluation, next-run-date search, and validation errors. A fake clock
 * drives the "no explicit now" paths.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { CronExpression } from '@/Scheduling/CronExpression';

/** Local-time date builder: month is 1-based for readable tests */
function at(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): Date {
  return new Date(year, month - 1, day, hour, minute, second);
}

describe('CronExpression parsing', () => {
  it('rejects expressions that are not five fields', () => {
    expect(() => new CronExpression('* * * *')).toThrow(/expected 5 fields/);
    expect(() => new CronExpression('* * * * * *')).toThrow(/expected 5 fields/);
  });

  it('rejects out-of-range values per field', () => {
    expect(() => new CronExpression('60 * * * *')).toThrow(/minute/);
    expect(() => new CronExpression('0 24 * * *')).toThrow(/hour/);
    expect(() => new CronExpression('0 0 32 * *')).toThrow(/day of month/);
    expect(() => new CronExpression('0 0 1 13 *')).toThrow(/month/);
    expect(() => new CronExpression('0 0 * * 8')).toThrow(/day of week/);
  });

  it('rejects unknown names and malformed items', () => {
    expect(() => new CronExpression('foo * * * *')).toThrow(/unknown value/);
    expect(() => new CronExpression('0 0 * * XYZ')).toThrow(/unknown value/);
    expect(() => new CronExpression('5-2 * * * *')).toThrow(/start exceeds end/);
    expect(() => new CronExpression('*/0 * * * *')).toThrow(/step/);
  });

  it('memoises instances by expression like Laravel expressionFor()', () => {
    const first = CronExpression.expressionFor('*/5 * * * *');
    const second = CronExpression.expressionFor('*/5 * * * *');

    expect(second).toBe(first);
    expect(first.getExpression()).toBe('*/5 * * * *');
  });
});

describe('CronExpression.isDue', () => {
  it('matches every minute with `* * * * *`', () => {
    const every = new CronExpression('* * * * *');

    expect(every.isDue(at(2026, 11, 12, 0, 0))).toBe(true);
    expect(every.isDue(at(2026, 11, 15, 23, 59, 37))).toBe(true);
  });

  it('matches every five minutes with `*/5 * * * *`', () => {
    const every5 = new CronExpression('*/5 * * * *');

    expect(every5.isDue(at(2026, 11, 12, 10, 0))).toBe(true);
    expect(every5.isDue(at(2026, 11, 12, 10, 25))).toBe(true);
    expect(every5.isDue(at(2026, 11, 12, 10, 55))).toBe(true);
    expect(every5.isDue(at(2026, 11, 12, 10, 3))).toBe(false);
  });

  it('matches weekdays at nine with `0 9 * * 1-5`', () => {
    // Nov 12 2026 is a Thursday; Nov 14 is Saturday, Nov 15 Sunday.
    const weekdays = new CronExpression('0 9 * * 1-5');

    expect(weekdays.isDue(at(2026, 11, 12, 9, 0))).toBe(true);
    expect(weekdays.isDue(at(2026, 11, 16, 9, 0))).toBe(true); // Monday
    expect(weekdays.isDue(at(2026, 11, 14, 9, 0))).toBe(false); // Saturday
    expect(weekdays.isDue(at(2026, 11, 15, 9, 0))).toBe(false); // Sunday
    expect(weekdays.isDue(at(2026, 11, 12, 9, 1))).toBe(false); // wrong minute
    expect(weekdays.isDue(at(2026, 11, 12, 8, 0))).toBe(false); // wrong hour
  });

  it('matches the first of the month with `0 0 1 * *`', () => {
    const monthly = new CronExpression('0 0 1 * *');

    expect(monthly.isDue(at(2026, 11, 1, 0, 0))).toBe(true);
    expect(monthly.isDue(at(2026, 12, 1, 0, 0))).toBe(true);
    expect(monthly.isDue(at(2026, 11, 2, 0, 0))).toBe(false);
    expect(monthly.isDue(at(2026, 11, 1, 0, 1))).toBe(false);
  });

  it('matches Sundays with `0 0 * * 0` and accepts 7 as Sunday too', () => {
    const sundays = new CronExpression('0 0 * * 0');
    const sundaysAsSeven = new CronExpression('0 0 * * 7');

    // Nov 15 2026 is a Sunday.
    expect(sundays.isDue(at(2026, 11, 15, 0, 0))).toBe(true);
    expect(sundays.isDue(at(2026, 11, 16, 0, 0))).toBe(false);
    expect(sundaysAsSeven.isDue(at(2026, 11, 15, 0, 0))).toBe(true);
    expect(sundaysAsSeven.isDue(at(2026, 11, 14, 0, 0))).toBe(false);
  });

  it('supports comma lists, ranges, and stepped ranges', () => {
    expect(new CronExpression('0,30 * * * *').isDue(at(2026, 11, 12, 5, 30))).toBe(true);
    expect(new CronExpression('0,30 * * * *').isDue(at(2026, 11, 12, 5, 15))).toBe(false);

    expect(new CronExpression('10-12 * * * *').isDue(at(2026, 11, 12, 4, 11))).toBe(true);
    expect(new CronExpression('10-12 * * * *').isDue(at(2026, 11, 12, 4, 13))).toBe(false);

    expect(new CronExpression('0-30/10 * * * *').isDue(at(2026, 11, 12, 4, 20))).toBe(true);
    expect(new CronExpression('0-30/10 * * * *').isDue(at(2026, 11, 12, 4, 35))).toBe(false);

    // `5/15` means every 15th minute from :05 to the end of the hour.
    expect(new CronExpression('5/15 * * * *').isDue(at(2026, 11, 12, 4, 50))).toBe(true);
    expect(new CronExpression('5/15 * * * *').isDue(at(2026, 11, 12, 4, 52))).toBe(false);
  });

  it('supports month and weekday names (case-insensitive)', () => {
    expect(new CronExpression('0 0 * JUL *').isDue(at(2026, 7, 1, 0, 0))).toBe(true);
    expect(new CronExpression('0 0 * jul *').isDue(at(2026, 7, 1, 0, 0))).toBe(true);
    expect(new CronExpression('0 0 * JUL *').isDue(at(2026, 8, 1, 0, 0))).toBe(false);

    expect(new CronExpression('0 0 * * SUN').isDue(at(2026, 11, 15, 0, 0))).toBe(true);
    expect(new CronExpression('0 0 * * MON-FRI').isDue(at(2026, 11, 12, 0, 0))).toBe(true);
    expect(new CronExpression('0 0 * * MON-FRI').isDue(at(2026, 11, 14, 0, 0))).toBe(false);
  });

  it('applies POSIX day semantics: both dom and dow restricted means OR', () => {
    // Run on the 13th of any month OR on Fridays.
    const either = new CronExpression('0 0 13 * 5');

    expect(either.isDue(at(2026, 11, 13, 0, 0))).toBe(true); // the 13th (Friday, but also dom)
    expect(either.isDue(at(2026, 12, 13, 0, 0))).toBe(true); // the 13th (Sunday)
    expect(either.isDue(at(2026, 11, 20, 0, 0))).toBe(true); // a Friday, not the 13th
    expect(either.isDue(at(2026, 11, 16, 0, 0))).toBe(false); // Monday, not the 13th
  });

  it('evaluates in the given timezone when one is provided', () => {
    const bangkokMorning = new CronExpression('0 9 * * *');

    // 02:00 UTC is 09:00 in Asia/Bangkok (UTC+7).
    const morningInBangkok = at(2026, 11, 12, 2, 0);

    expect(bangkokMorning.isDue(morningInBangkok, 'Asia/Bangkok')).toBe(true);
    expect(bangkokMorning.isDue(morningInBangkok)).toBe(false);
    expect(bangkokMorning.isDue(at(2026, 11, 12, 9, 0), 'Asia/Bangkok')).toBe(false);
  });

  it('uses the system clock when no time is given', () => {
    vi.useFakeTimers();

    try {
      vi.setSystemTime(at(2026, 11, 12, 14, 35));

      expect(new CronExpression('35 14 * * *').isDue()).toBe(true);
      expect(new CronExpression('36 14 * * *').isDue()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('CronExpression.nextRunDate', () => {
  it('finds the next minute for `* * * * *`', () => {
    const next = new CronExpression('* * * * *').nextRunDate(at(2026, 11, 12, 10, 30, 45));

    expect(next).toEqual(at(2026, 11, 12, 10, 31));
  });

  it('skips to the next matching weekday for `0 9 * * 1-5`', () => {
    // Thursday Nov 12 at 10:00 -> Friday Nov 13 at 09:00
    const next = new CronExpression('0 9 * * 1-5').nextRunDate(at(2026, 11, 12, 10, 0));

    expect(next).toEqual(at(2026, 11, 13, 9, 0));
  });

  it('crosses the year boundary for monthly expressions', () => {
    const next = new CronExpression('0 0 1 * *').nextRunDate(at(2026, 11, 12, 10, 0));

    expect(next).toEqual(at(2026, 12, 1, 0, 0));
  });

  it('reaches the leap day within the search window', () => {
    const next = new CronExpression('0 0 29 2 *').nextRunDate(at(2026, 11, 12, 10, 0));

    expect(next).toEqual(at(2028, 2, 29, 0, 0));
  });

  it('honours a timezone for the run date', () => {
    const next = new CronExpression('0 9 * * *').nextRunDate(at(2026, 11, 12, 3, 0), 'Asia/Bangkok');

    // 09:00 Bangkok on Nov 12 is 02:00 UTC - already past 03:00 UTC,
    // so the next run is Nov 13 02:00 UTC (09:00 Bangkok).
    expect(next).toEqual(at(2026, 11, 13, 2, 0));
  });

  it('returns the next weekday run across a weekend gap', () => {
    // Friday Nov 13 10:00 -> Monday Nov 16 09:00
    const next = new CronExpression('0 9 * * 1-5').nextRunDate(at(2026, 11, 13, 10, 0));

    expect(next).toEqual(at(2026, 11, 16, 9, 0));
  });
});

describe('CronExpression.format', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders a zero-padded local datetime', () => {
    expect(CronExpression.format(at(2026, 11, 5, 9, 3, 7))).toBe('2026-11-05 09:03:07');
  });

  it('renders a datetime inside the given timezone', () => {
    const utc = at(2026, 11, 12, 2, 0, 0);

    expect(CronExpression.format(utc, 'Asia/Bangkok')).toBe('2026-11-12 09:00:00');
  });
});
