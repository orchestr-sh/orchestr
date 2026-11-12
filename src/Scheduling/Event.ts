/**
 * Event
 *
 * A single scheduled task. Wraps a ScheduledTask with the fluent,
 * Laravel-shaped API for describing when it runs (`everyMinute()`,
 * `dailyAt()`, `mondays()`, ...) and how it runs (`withoutOverlapping()`,
 * `onOneServer()`, callbacks, ...).
 *
 * Mirrors `Illuminate\Console\Scheduling\Event`.
 *
 * @example
 * ```typescript
 * schedule
 *   .command('report:generate')
 *   .weeklyOn(1, '09:00')
 *   .withoutOverlapping();
 * ```
 */

import { createHash } from 'node:crypto';
import type { ScheduledTask } from './Contracts/ScheduledTask';
import type { Schedule } from './Schedule';
import { CronExpression } from './CronExpression';

/**
 * Filter callbacks receive the moment under consideration and return
 * either a boolean, or a string where an empty string means "pass" and a
 * non-empty string is the reason the event did not run (Laravel's
 * string-reason filters).
 */
export type EventFilter = (now: Date) => boolean | string;

/** before/after/onSuccess callbacks receive the event */
export type EventCallback = (event: Event) => void | Promise<void>;

/** onFailure callbacks receive the thrown error and the event */
export type EventFailureCallback = (error: unknown, event: Event) => void | Promise<void>;

/** Normalized filter: reports whether the event passes and why not */
interface NormalizedFilter {
  evaluate: (now: Date) => { pass: boolean; reason?: string };
}

/** Result of running an event once */
export type EventRunOutcome =
  | { status: 'success' }
  | { status: 'failure'; error: unknown }
  | { status: 'skipped'; reason: 'mutex' };

const MINUTES_PER_HOUR = 60;

/**
 * Parse a time into hour/minute parts. Accepts 'HH:mm', 'HH:mm:ss',
 * 'H:mm', and integer shorthand like 930 (09:30) or 1300 (13:00).
 */
export function parseClockTime(time: string | number): { hour: number; minute: number } {
  if (typeof time === 'number') {
    return normalizeClock(Math.floor(time / 100), time % 100, String(time));
  }

  const parts = String(time).split(':');

  if (parts.length < 2) {
    throw new Error(`Invalid time [${time}]: expected HH:mm.`);
  }

  return normalizeClock(Number(parts[0]), Number(parts[1]), String(time));
}

function normalizeClock(hour: number, minute: number, raw: string): { hour: number; minute: number } {
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error(`Invalid time [${raw}]: expected an hour between 0-23 and minutes between 0-59.`);
  }

  return { hour, minute };
}

/**
 * Replace the day-of-week segment of a five-field cron expression, leaving
 * the other fields (including the current time) intact, so `days()` and
 * the weekday helpers layer onto existing schedules.
 */
function replaceDayOfWeek(expression: string, weekdays: (number | string)[]): string {
  const segments = expression.trim().split(/\s+/);

  segments[4] = weekdays.join(',');

  return segments.join(' ');
}

export class Event {
  /** Cron expression the event matches on (Laravel defaults to every minute) */
  protected expression = '* * * * *';

  /** Optional IANA timezone the expression is evaluated in */
  protected eventTimezone?: string;

  /** Optional name overriding the task description in listings */
  protected eventDescription?: string;

  protected filters: NormalizedFilter[] = [];
  protected beforeCallbacks: EventCallback[] = [];
  protected afterCallbacks: EventCallback[] = [];
  protected successCallbacks: EventCallback[] = [];
  protected failureCallbacks: EventFailureCallback[] = [];

  protected overlapping = false;
  protected overlappingExpiresAfter = 1440;
  protected oneServer = false;

  /** Seconds the onOneServer mutex lives once claimed */
  protected oneServerExpiresAfter = 1440;

  protected background = false;
  protected maintenanceAgnostic = false;

  constructor(
    protected readonly task: ScheduledTask,
    protected readonly schedule: Schedule,
    name?: string
  ) {
    if (name) {
      this.eventDescription = name;
    }
  }

  // --- Frequency fluent API ---

  /**
   * Set a raw five-field cron expression
   */
  cron(expression: string): this {
    // Validate eagerly so a typo fails at definition time, like Laravel.
    this.expression = CronExpression.expressionFor(expression).getExpression();

    return this;
  }

  everyMinute(): this {
    return this.cron('* * * * *');
  }

  everyFiveMinutes(): this {
    return this.cron('*/5 * * * *');
  }

  everyTenMinutes(): this {
    return this.cron('*/10 * * * *');
  }

  everyFifteenMinutes(): this {
    return this.cron('*/15 * * * *');
  }

  everyThirtyMinutes(): this {
    return this.cron('0,30 * * * *');
  }

  hourly(): this {
    return this.cron('0 * * * *');
  }

  /**
   * Run once per hour at the given minute(s)
   */
  hourlyAt(minute: number | number[] = 0): this {
    const minutes = (Array.isArray(minute) ? minute : [minute]).join(',');

    return this.cron(`${minutes} * * * *`);
  }

  daily(): this {
    return this.cron('0 0 * * *');
  }

  /**
   * Run daily at the given time, e.g. `dailyAt('09:30')`
   */
  dailyAt(time: string | number): this {
    const { hour, minute } = parseClockTime(time);

    return this.cron(`${minute} ${hour} * * *`);
  }

  /**
   * Run twice daily at the given hours (defaults: 01:00 and 13:00)
   */
  twiceDaily(first = 1, second = 13): this {
    return this.cron(`0 ${first},${second} * * *`);
  }

  weekly(): this {
    return this.cron('0 0 * * 0');
  }

  /**
   * Run weekly on the given day (0 = Sunday, 7 also accepted) at the
   * given time
   */
  weeklyOn(weekDay: number | string, time: string | number = '0:00'): this {
    const { hour, minute } = parseClockTime(time);

    return this.cron(`${minute} ${hour} * * ${weekDay}`);
  }

  monthly(): this {
    return this.cron('0 0 1 * *');
  }

  /**
   * Run monthly on the given day-of-month at the given time
   */
  monthlyOn(weekDayOfMonth = 1, time: string | number = '0:00'): this {
    const { hour, minute } = parseClockTime(time);

    return this.cron(`${minute} ${hour} ${weekDayOfMonth} * *`);
  }

  quarterly(): this {
    return this.cron('0 0 1 1,4,7,10 *');
  }

  yearly(): this {
    return this.cron('0 0 1 1 *');
  }

  /**
   * Run daily on weekdays at midnight (Mon-Fri)
   */
  weekdays(): this {
    return this.cron('0 0 * * 1-5');
  }

  /**
   * Run daily on weekends at midnight (Sat, Sun)
   */
  weekends(): this {
    return this.cron('0 0 * * 0,6');
  }

  /**
   * Restrict the event to the given days of the week (0 = Sunday),
   * keeping the current minute/hour fields.
   */
  days(weekDays: number | string | (number | string)[]): this {
    const days = Array.isArray(weekDays) ? weekDays : [weekDays];

    return this.cron(replaceDayOfWeek(this.expression, days));
  }

  sundays(): this {
    return this.days(0);
  }

  mondays(): this {
    return this.days(1);
  }

  tuesdays(): this {
    return this.days(2);
  }

  wednesdays(): this {
    return this.days(3);
  }

  thursdays(): this {
    return this.days(4);
  }

  fridays(): this {
    return this.days(5);
  }

  saturdays(): this {
    return this.days(6);
  }

  /**
   * Run only between the given times ('HH:mm'), inclusive. Ranges that
   * cross midnight (`between('22:00', '02:00')`) are supported.
   */
  between(startTime: string, endTime: string): this {
    return this.when((now) =>
      this.inTimeRange(now, startTime, endTime) ? '' : 'The time is outside the event window.'
    );
  }

  /**
   * Skip the event while the current time is between the given times
   */
  unlessBetween(startTime: string, endTime: string): this {
    return this.skip((now) =>
      this.inTimeRange(now, startTime, endTime) ? 'The time is inside the excluded window.' : ''
    );
  }

  // --- Timezone ---

  /**
   * Evaluate the cron expression (and time windows) in the given IANA
   * timezone instead of the host default.
   */
  timezone(timezone: string): this {
    this.eventTimezone = timezone;

    return this;
  }

  // --- Modifiers ---

  /**
   * Do not let overlapping instances of this event run concurrently. Uses
   * the cache lock store, so protection extends across processes; the
   * lock is released when the run finishes.
   */
  withoutOverlapping(expiresAfter: number = 1440): this {
    this.overlapping = true;
    this.overlappingExpiresAfter = expiresAfter;

    return this;
  }

  /**
   * Only run this event on one server at a time. Uses the cache lock:
   * the first process to claim the lock holds it until it expires, so
   * other processes sharing the cache skip their attempt.
   */
  onOneServer(): this {
    this.oneServer = true;

    return this;
  }

  /**
   * Do not await the task inside `Schedule.run()`. Shell commands are
   * detached; closures/jobs/commands keep running without blocking the
   * rest of the minute's events.
   */
  runInBackground(): this {
    this.background = true;

    return this;
  }

  /**
   * Keep running this event even while the application is in maintenance
   * mode.
   */
  evenInMaintenanceMode(): this {
    this.maintenanceAgnostic = true;

    return this;
  }

  /**
   * Only run the event when the callback passes. The callback may return a
   * boolean, or a string where an empty string passes and a non-empty
   * string is the failure reason (Laravel-style string filters).
   */
  when(callback: EventFilter): this {
    this.filters.push({
      evaluate: (now) => {
        const result = callback(now);

        if (typeof result === 'string') {
          return { pass: result === '', reason: result === '' ? undefined : result };
        }

        return { pass: Boolean(result), reason: 'A filter prevented the event from running.' };
      },
    });

    return this;
  }

  /**
   * Skip the event while the callback passes (non-empty strings and
   * booleans both trigger the skip)
   */
  skip(callback: EventFilter): this {
    this.filters.push({
      evaluate: (now) => {
        const result = callback(now);

        if (typeof result === 'string') {
          return { pass: result === '', reason: result || 'A skip filter blocked the event.' };
        }

        return { pass: !result, reason: 'A skip filter blocked the event.' };
      },
    });

    return this;
  }

  // --- Callbacks ---

  before(callback: EventCallback): this {
    this.beforeCallbacks.push(callback);

    return this;
  }

  after(callback: EventCallback): this {
    this.afterCallbacks.push(callback);

    return this;
  }

  onSuccess(callback: EventCallback): this {
    this.successCallbacks.push(callback);

    return this;
  }

  onFailure(callback: EventFailureCallback): this {
    this.failureCallbacks.push(callback);

    return this;
  }

  // --- Naming ---

  /**
   * Override the description used in listings and failure output
   */
  name(description: string): this {
    this.eventDescription = description;

    return this;
  }

  // --- Accessors / matching ---

  getExpression(): string {
    return this.expression;
  }

  getTimezone(): string | undefined {
    return this.eventTimezone;
  }

  getDescription(): string {
    return this.eventDescription ?? this.task.description;
  }

  getTask(): ScheduledTask {
    return this.task;
  }

  isRunInBackground(): boolean {
    return this.background;
  }

  runsEvenInMaintenanceMode(): boolean {
    return this.maintenanceAgnostic;
  }

  isOverlappingProtected(): boolean {
    return this.overlapping;
  }

  isOnOneServer(): boolean {
    return this.oneServer;
  }

  /**
   * Determine whether the event is due at the given moment: the cron
   * expression must match (in the event's timezone) and all filters must
   * pass.
   */
  isDue(now: Date = new Date()): boolean {
    return this.expressionPasses(now) && this.filtersPass(now).passed;
  }

  /**
   * The expression match only, exposed so tests and tooling can inspect
   * either half of the due decision.
   */
  expressionPasses(now: Date = new Date()): boolean {
    return CronExpression.expressionFor(this.expression).isDue(now, this.eventTimezone);
  }

  /**
   * Evaluate the when/skip/between filters
   */
  filtersPass(now: Date): { passed: boolean; reason?: string } {
    for (const filter of this.filters) {
      const result = filter.evaluate(now);

      if (!result.pass) {
        return { passed: false, reason: result.reason };
      }
    }

    return { passed: true };
  }

  /**
   * The first moment strictly after `now` this event could run
   */
  nextRunDate(now: Date = new Date()): Date | null {
    return CronExpression.expressionFor(this.expression).nextRunDate(now, this.eventTimezone);
  }

  /**
   * Stable identity for mutex keys: same expression + description means
   * the same lock name across servers.
   */
  mutexName(): string {
    const digest = createHash('sha256').update(`${this.expression}:${this.getDescription()}`).digest('hex');

    return `schedule-run-${digest.slice(0, 32)}`;
  }

  // --- Running ---

  /**
   * Run the event once. Mutex modifiers are enforced, then the before
   * callbacks, the task, and the success/failure + after callbacks fire.
   * Never throws: failures are reported through the outcome and the
   * `onFailure` callbacks (Laravel logs scheduled failures the same way).
   */
  async run(): Promise<EventRunOutcome> {
    let acquired = false;

    if (this.overlapping || this.oneServer) {
      const mutex = this.schedule.getMutex();
      const expires = this.overlapping ? this.overlappingExpiresAfter : this.oneServerExpiresAfter;
      const reentrant = this.oneServer && !this.overlapping;

      if (!(await mutex.create(this.mutexName(), expires, reentrant))) {
        return { status: 'skipped', reason: 'mutex' };
      }

      acquired = true;
    }

    let failure: { status: 'failure'; error: unknown } | undefined;

    try {
      await this.fireCallbacks(this.beforeCallbacks.map((callback) => () => callback(this)));

      try {
        await this.task.run({ background: this.background });
      } catch (error) {
        failure = { status: 'failure', error };
        await this.fireCallbacks(this.failureCallbacks.map((callback) => () => callback(error, this)));
      }

      if (!failure) {
        await this.fireCallbacks(this.successCallbacks.map((callback) => () => callback(this)));
      }

      await this.fireCallbacks(this.afterCallbacks.map((callback) => () => callback(this)));
    } finally {
      // withoutOverlapping locks are released on completion. onOneServer
      // locks stay held deliberately: that is what keeps a second server
      // from starting the same run until the lock expires.
      if (this.overlapping && acquired) {
        await this.schedule.getMutex().release(this.mutexName());
      }
    }

    return failure ?? { status: 'success' };
  }

  /**
   * Whether `now`'s wall-clock minute falls inside an inclusive time
   * window, respecting the event timezone. Mirrors Laravel's
   * midnight-crossing `between()`.
   */
  protected inTimeRange(now: Date, startTime: string, endTime: string): boolean {
    const parts = CronExpression.timeParts(now, this.eventTimezone);
    const current = parts.hour * MINUTES_PER_HOUR + parts.minute;

    const start = parseClockTime(startTime);
    const end = parseClockTime(endTime);
    const startMinutes = start.hour * MINUTES_PER_HOUR + start.minute;
    const endMinutes = end.hour * MINUTES_PER_HOUR + end.minute;

    if (startMinutes <= endMinutes) {
      return current >= startMinutes && current <= endMinutes;
    }

    return current >= startMinutes || current <= endMinutes;
  }

  protected async fireCallbacks(callbacks: Array<() => void | Promise<void>>): Promise<void> {
    for (const callback of callbacks) {
      await callback();
    }
  }
}
