/**
 * Event (scheduled task) tests
 *
 * Covers the fluent frequency API's generated expressions, between /
 * unlessBetween / when / skip filtering, timezone-aware due checks,
 * callback ordering (before/onSuccess/onFailure/after), next-run dates,
 * and the overlap mutex using the process-wide fallback cache.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { Event } from '@/Scheduling/Event';
import { Schedule } from '@/Scheduling/Schedule';
import { CallbackTask } from '@/Scheduling/Tasks/CallbackTask';

/** Local-time date builder: month is 1-based for readable tests */
function at(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): Date {
  return new Date(year, month - 1, day, hour, minute, second);
}

function makeEvent(description?: string): Event {
  const schedule = new Schedule();
  const task = new CallbackTask(() => undefined, description ?? 'Closure');

  return new Event(task, schedule, description);
}

describe('Event frequency API', () => {
  it.each([
    ['everyMinute', (e: Event) => e.everyMinute(), '* * * * *'],
    ['everyFiveMinutes', (e: Event) => e.everyFiveMinutes(), '*/5 * * * *'],
    ['everyTenMinutes', (e: Event) => e.everyTenMinutes(), '*/10 * * * *'],
    ['everyFifteenMinutes', (e: Event) => e.everyFifteenMinutes(), '*/15 * * * *'],
    ['everyThirtyMinutes', (e: Event) => e.everyThirtyMinutes(), '0,30 * * * *'],
    ['hourly', (e: Event) => e.hourly(), '0 * * * *'],
    ['hourlyAt', (e: Event) => e.hourlyAt(15), '15 * * * *'],
    ['hourlyAt many', (e: Event) => e.hourlyAt([0, 30]), '0,30 * * * *'],
    ['daily', (e: Event) => e.daily(), '0 0 * * *'],
    ['dailyAt', (e: Event) => e.dailyAt('09:00'), '0 9 * * *'],
    ['dailyAt half', (e: Event) => e.dailyAt('13:30'), '30 13 * * *'],
    ['dailyAt integer', (e: Event) => e.dailyAt(1300), '0 13 * * *'],
    ['twiceDaily', (e: Event) => e.twiceDaily(), '0 1,13 * * *'],
    ['weekly', (e: Event) => e.weekly(), '0 0 * * 0'],
    ['weeklyOn', (e: Event) => e.weeklyOn(1, '09:00'), '0 9 * * 1'],
    ['monthly', (e: Event) => e.monthly(), '0 0 1 * *'],
    ['monthlyOn', (e: Event) => e.monthlyOn(1, '00:00'), '0 0 1 * *'],
    ['monthlyOn the 15th', (e: Event) => e.monthlyOn(15, '12:30'), '30 12 15 * *'],
    ['quarterly', (e: Event) => e.quarterly(), '0 0 1 1,4,7,10 *'],
    ['yearly', (e: Event) => e.yearly(), '0 0 1 1 *'],
    ['weekdays', (e: Event) => e.weekdays(), '0 0 * * 1-5'],
    ['weekends', (e: Event) => e.weekends(), '0 0 * * 0,6'],
  ])('generates the expected expression for %s', (_name, apply, expected) => {
    expect(apply(makeEvent()).getExpression()).toBe(expected);
  });

  it('replaces only the day-of-week segment via days() and the weekday helpers', () => {
    expect(makeEvent().dailyAt('09:30').mondays().getExpression()).toBe('30 9 * * 1');
    expect(makeEvent().dailyAt('09:30').sundays().getExpression()).toBe('30 9 * * 0');
    expect(makeEvent().hourly().days([1, 3, 5]).getExpression()).toBe('0 * * * 1,3,5');
    expect(makeEvent().hourly().days(2).fridays().getExpression()).toBe('0 * * * 5');
  });

  it('validates cron expressions eagerly', () => {
    expect(() => makeEvent().cron('nonsense')).toThrow();
    expect(makeEvent().cron('0 9 * * 1-5').getExpression()).toBe('0 9 * * 1-5');
  });

  it('reports due/not-due against a fake clock', () => {
    vi.useFakeTimers();

    try {
      // Thursday Nov 12 2026, 09:00 local.
      vi.setSystemTime(at(2026, 11, 12, 9, 0));

      expect(makeEvent().dailyAt('09:00').isDue()).toBe(true);
      expect(
        makeEvent()
          .dailyAt('09:00')
          .isDue(at(2026, 11, 12, 9, 1))
      ).toBe(false);
      expect(makeEvent().weeklyOn(1, '09:00').isDue()).toBe(false); // Thursday, not Monday
      expect(makeEvent().weeklyOn(4, '09:00').isDue()).toBe(true);
      expect(makeEvent().monthlyOn(1, '00:00').isDue()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('evaluates due checks in the event timezone', () => {
    const event = makeEvent().dailyAt('09:00').timezone('Asia/Bangkok');

    // 02:00 UTC is 09:00 Bangkok.
    expect(event.isDue(at(2026, 11, 12, 2, 0))).toBe(true);
    expect(event.isDue(at(2026, 11, 12, 9, 0))).toBe(false);
  });

  it('computes the next run date from a fake clock', () => {
    vi.useFakeTimers();

    try {
      vi.setSystemTime(at(2026, 11, 12, 10, 0));

      expect(makeEvent().dailyAt('09:00').nextRunDate()).toEqual(at(2026, 11, 13, 9, 0));
      expect(makeEvent().everyMinute().nextRunDate()).toEqual(at(2026, 11, 12, 10, 1));
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Event time windows and filters', () => {
  const now = at(2026, 11, 12, 10, 0);

  it('between() only allows moments inside the window', () => {
    const inside = makeEvent().everyMinute().between('09:00', '17:00');
    const outside = makeEvent().everyMinute().between('11:00', '17:00');

    expect(inside.isDue(now)).toBe(true);
    expect(outside.isDue(now)).toBe(false);
  });

  it('between() supports windows crossing midnight', () => {
    const lateNight = makeEvent().everyMinute().between('22:00', '02:00');

    expect(lateNight.isDue(at(2026, 11, 12, 23, 30))).toBe(true);
    expect(lateNight.isDue(at(2026, 11, 12, 1, 30))).toBe(true);
    expect(lateNight.isDue(at(2026, 11, 12, 12, 0))).toBe(false);
  });

  it('unlessBetween() blocks moments inside the window', () => {
    const event = makeEvent().everyMinute().unlessBetween('09:00', '17:00');

    expect(event.isDue(now)).toBe(false);
    expect(event.isDue(at(2026, 11, 12, 18, 0))).toBe(true);
  });

  it('when() and skip() consult their callbacks with the current moment', () => {
    let seen: Date | undefined;

    const allowed = makeEvent()
      .everyMinute()
      .when((n) => {
        seen = n;

        return true;
      });
    const blocked = makeEvent()
      .everyMinute()
      .when(() => false);
    const skipped = makeEvent()
      .everyMinute()
      .skip(() => true);

    expect(allowed.isDue(now)).toBe(true);
    expect(seen).toBe(now);
    expect(blocked.isDue(now)).toBe(false);
    expect(skipped.isDue(now)).toBe(false);
  });

  it('string filter results report a failure reason', () => {
    const filters = makeEvent()
      .everyMinute()
      .when(() => 'maintenance window');

    expect(filters.filtersPass(now)).toEqual({ passed: false, reason: 'maintenance window' });
    expect(
      makeEvent()
        .everyMinute()
        .when(() => '')
        .filtersPass(now).passed
    ).toBe(true);
  });

  it('exposes the task description and name overrides', () => {
    const schedule = new Schedule();
    const event = new Event(new CallbackTask(() => undefined, 'nightly job'), schedule);

    expect(event.getDescription()).toBe('nightly job');
    expect(event.name('database backup').getDescription()).toBe('database backup');
  });
});

describe('Event callbacks', () => {
  it('fires before, the task, onSuccess, then after on success', async () => {
    const order: string[] = [];
    const event = makeEvent('callback order')
      .everyMinute()
      .before(() => {
        order.push('before');
      })
      .onSuccess(() => {
        order.push('success');
      })
      .onFailure(() => {
        order.push('failure');
      })
      .after(() => {
        order.push('after');
      });

    const outcome = await event.run();

    expect(outcome).toEqual({ status: 'success' });
    expect(order).toEqual(['before', 'success', 'after']);
  });

  it('fires onFailure with the error and still runs after callbacks', async () => {
    const order: string[] = [];
    const failure = new Error('boom');
    const schedule = new Schedule();
    const event = new Event(
      new CallbackTask(() => {
        throw failure;
      }, 'failing task'),
      schedule
    ).everyMinute();

    event
      .before(() => {
        order.push('before');
      })
      .onSuccess(() => {
        order.push('success');
      })
      .onFailure((error) => {
        order.push(`failure:${error instanceof Error ? error.message : String(error)}`);
      })
      .after(() => {
        order.push('after');
      });

    const outcome = await event.run();

    expect(outcome).toEqual({ status: 'failure', error: failure });
    expect(order).toEqual(['before', 'failure:boom', 'after']);
  });
});

describe('Event overlap mutex', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('withoutOverlapping blocks a second concurrent run, then allows later runs', async () => {
    const releases: Array<() => void> = [];
    let runs = 0;

    const schedule = new Schedule();
    const event = schedule
      .call(async () => {
        runs++;

        await new Promise<void>((resolve) => releases.push(resolve));
      }, 'contended task')
      .everyMinute()
      .withoutOverlapping();

    // Start two runs for the same minute without awaiting the first.
    const first = event.run();
    await flushMicrotasks();

    const second = await event.run();

    expect(second).toEqual({ status: 'skipped', reason: 'mutex' });
    expect(runs).toBe(1);

    releases.shift()!();
    expect(await first).toEqual({ status: 'success' });

    // The lock was released when the task finished, so a later run passes.
    const third = event.run();
    await flushMicrotasks();

    expect(runs).toBe(2);

    releases.shift()!();
    expect(await third).toEqual({ status: 'success' });
    expect(event.isOverlappingProtected()).toBe(true);
  });
});

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 30; i++) {
    await Promise.resolve();
  }
}
