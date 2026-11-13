/**
 * CronExpression
 *
 * Parser and matcher for standard five-field cron expressions
 * (`minute hour day-of-month month day-of-week`). Mirrors the subset of
 * cron behaviour Laravel gets from dragonmantank/cron-expression:
 *
 * - `*` wildcards and lists (`0,15,30,45`)
 * - ranges (`1-5`)
 * - steps: an asterisk or range followed by `/n` (the every-five-minutes
 *   shape, `1-10/2`, `5/15`)
 * - three-letter month names (JAN-DEC) and weekday names (SUN-SAT)
 * - Sunday accepted as both `0` and `7`
 * - POSIX day-of-month / day-of-week semantics: when both fields are
 *   restricted a date matches if *either* one matches
 *
 * @example
 * ```typescript
 * const expression = new CronExpression('0 9 * * 1-5');
 *
 * expression.isDue(new Date('2026-11-12T09:00:00')); // Thursday -> true
 * expression.nextRunDate(); // the next weekday at 09:00
 * ```
 */

interface FieldDefinition {
  /** Field name used in error messages */
  name: string;
  min: number;
  max: number;
  /** Case-insensitive three-letter aliases mapped to their numeric value */
  aliases?: Record<string, number>;
}

/** A single parsed cron field: the set of values it allows plus wildcard state */
interface ParsedField {
  /** True when the whole field was a bare `*` (unrestricted) */
  wildcard: boolean;
  values: Set<number>;
}

const MINUTE_FIELD: FieldDefinition = { name: 'minute', min: 0, max: 59 };
const HOUR_FIELD: FieldDefinition = { name: 'hour', min: 0, max: 23 };
const DAY_OF_MONTH_FIELD: FieldDefinition = { name: 'day of month', min: 1, max: 31 };

const MONTH_ALIASES: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

const MONTH_FIELD: FieldDefinition = { name: 'month', min: 1, max: 12, aliases: MONTH_ALIASES };

const WEEKDAY_ALIASES: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

// Sunday may be written as 0 or 7; both are normalised to 0.
const WEEKDAY_FIELD: FieldDefinition = { name: 'day of week', min: 0, max: 7, aliases: WEEKDAY_ALIASES };

/** Break-down of a moment into the calendar fields cron matches on */
export interface CronTimeParts {
  year: number;
  minute: number;
  hour: number;
  dayOfMonth: number;
  month: number;
  /** 0 (Sunday) through 6 (Saturday) */
  dayOfWeek: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function zoneFormatter(timezone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timezone);

  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timezone, formatter);
  }

  return formatter;
}

function readZoneParts(
  date: Date,
  timezone: string
): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const values: Record<string, number> = {};

  for (const part of zoneFormatter(timezone).formatToParts(date)) {
    if (part.type !== 'literal') {
      values[part.type] = Number(part.value);
    }
  }

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    // hourCycle h23 keeps midnight at 0 rather than some locales' 24
    hour: values.hour % 24,
    minute: values.minute,
    second: values.second,
  };
}

/**
 * Difference, in milliseconds, between the wall clock in `timezone` and UTC
 * at the given instant.
 */
function zoneOffsetMs(instant: number, timezone: string): number {
  const parts = readZoneParts(new Date(instant), timezone);
  const wallClock = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);

  return wallClock - Math.floor(instant / 1000) * 1000;
}

/**
 * Convert a wall-clock timestamp in `timezone` (built as if it were UTC)
 * into the real UTC instant. A second pass corrects DST boundaries where the
 * offset changes between the guess and the actual moment.
 */
function zoneToInstant(wallClockAsUtc: number, timezone: string): number {
  const offset = zoneOffsetMs(wallClockAsUtc, timezone);
  const adjusted = wallClockAsUtc - offset;
  const secondOffset = zoneOffsetMs(adjusted, timezone);

  return secondOffset === offset ? adjusted : wallClockAsUtc - secondOffset;
}

export class CronExpression {
  /** Memoised instances keyed by expression string */
  private static readonly instances = new Map<string, CronExpression>();

  protected readonly minuteField: ParsedField;
  protected readonly hourField: ParsedField;
  protected readonly dayOfMonthField: ParsedField;
  protected readonly monthField: ParsedField;
  protected readonly dayOfWeekField: ParsedField;

  /**
   * Parse (or reuse) an expression. Mirrors Laravel's
   * `CronExpression::expressionFor()`.
   */
  static expressionFor(expression: string): CronExpression {
    const existing = CronExpression.instances.get(expression);

    if (existing) {
      return existing;
    }

    const parsed = new CronExpression(expression);
    CronExpression.instances.set(expression, parsed);

    return parsed;
  }

  constructor(protected readonly expression: string) {
    const fields = expression.trim().split(/\s+/);

    if (fields.length !== 5) {
      throw new Error(`Invalid cron expression [${expression}]: expected 5 fields, got ${fields.length}.`);
    }

    this.minuteField = CronExpression.parseField(fields[0], MINUTE_FIELD, expression);
    this.hourField = CronExpression.parseField(fields[1], HOUR_FIELD, expression);
    this.dayOfMonthField = CronExpression.parseField(fields[2], DAY_OF_MONTH_FIELD, expression);
    this.monthField = CronExpression.parseField(fields[3], MONTH_FIELD, expression);
    this.dayOfWeekField = CronExpression.parseField(fields[4], WEEKDAY_FIELD, expression);
  }

  /**
   * Get the raw expression text
   */
  getExpression(): string {
    return this.expression;
  }

  /**
   * Determine whether the expression matches the given moment. When a
   * timezone is provided the comparison happens against that zone's wall
   * clock, exactly like Laravel's `$timezone` support.
   */
  isDue(now: Date = new Date(), timezone?: string): boolean {
    const parts = CronExpression.timeParts(now, timezone);

    return (
      this.minuteField.values.has(parts.minute) &&
      this.hourField.values.has(parts.hour) &&
      this.monthField.values.has(parts.month) &&
      this.dateMatches(parts)
    );
  }

  /**
   * The day-of-month / day-of-week combination follows POSIX cron: when
   * both fields are restricted a date matches when either field does,
   * otherwise only the restricted field is consulted.
   */
  protected dateMatches(parts: CronTimeParts): boolean {
    const matchesDayOfMonth = this.dayOfMonthField.values.has(parts.dayOfMonth);
    const matchesDayOfWeek = this.dayOfWeekField.values.has(parts.dayOfWeek);

    if (this.dayOfMonthField.wildcard && this.dayOfWeekField.wildcard) {
      return true;
    }

    if (this.dayOfMonthField.wildcard) {
      return matchesDayOfWeek;
    }

    if (this.dayOfWeekField.wildcard) {
      return matchesDayOfMonth;
    }

    return matchesDayOfMonth || matchesDayOfWeek;
  }

  /**
   * The first moment strictly after `from` when this expression matches.
   * The search walks whole calendar days (so DST never skips one) and is
   * bounded to roughly four years (enough to cover a February-29-only
   * schedule); `null` means "never" within that window.
   */
  nextRunDate(from: Date = new Date(), timezone?: string): Date | null {
    // Start searching from the beginning of the next minute.
    const startMs = Math.floor(from.getTime() / 60_000) * 60_000 + 60_000;
    const startParts = CronExpression.timeParts(new Date(startMs), timezone);

    const hours = Array.from(this.hourField.values).sort((a, b) => a - b);
    const minutes = Array.from(this.minuteField.values).sort((a, b) => a - b);

    for (let offset = 0; offset < 4 * 366; offset++) {
      const dayWall = Date.UTC(startParts.year, startParts.month - 1, startParts.dayOfMonth + offset);
      const day = new Date(dayWall);
      const year = day.getUTCFullYear();
      const month = day.getUTCMonth() + 1;
      const dayOfMonth = day.getUTCDate();
      const dayOfWeek = day.getUTCDay();

      if (!this.monthField.values.has(month)) {
        continue;
      }

      if (!this.dateMatches({ year, minute: 0, hour: 0, dayOfMonth, month, dayOfWeek })) {
        continue;
      }

      for (const hour of hours) {
        for (const minute of minutes) {
          const candidate = timezone
            ? zoneToInstant(Date.UTC(year, month - 1, dayOfMonth, hour, minute), timezone)
            : new Date(year, month - 1, dayOfMonth, hour, minute, 0, 0).getTime();

          if (candidate >= startMs) {
            return new Date(candidate);
          }
        }
      }
    }

    return null;
  }

  /**
   * Decompose a moment into cron-matched calendar fields. Without a
   * timezone the host's local calendar is used, matching Laravel's reliance
   * on the PHP timezone defaults.
   */
  static timeParts(date: Date, timezone?: string): CronTimeParts {
    if (!timezone) {
      return {
        year: date.getFullYear(),
        minute: date.getMinutes(),
        hour: date.getHours(),
        dayOfMonth: date.getDate(),
        month: date.getMonth() + 1,
        dayOfWeek: date.getDay(),
      };
    }

    const wallClock = date.getTime() + zoneOffsetMs(date.getTime(), timezone);
    const asUtc = new Date(wallClock);

    return {
      year: asUtc.getUTCFullYear(),
      minute: asUtc.getUTCMinutes(),
      hour: asUtc.getUTCHours(),
      dayOfMonth: asUtc.getUTCDate(),
      month: asUtc.getUTCMonth() + 1,
      dayOfWeek: asUtc.getUTCDay(),
    };
  }

  /**
   * Format a moment as a `YYYY-MM-DD HH:mm:ss` string in the given
   * timezone, used by `schedule:list`.
   */
  static format(date: Date, timezone?: string): string {
    if (!timezone) {
      const pad = (value: number, width = 2): string => String(value).padStart(width, '0');

      return (
        `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
        `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
      );
    }

    const parts = readZoneParts(date, timezone);
    const pad = (value: number): string => String(value).padStart(2, '0');

    return (
      `${parts.year}-${pad(parts.month)}-${pad(parts.day)} ` +
      `${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`
    );
  }

  /**
   * Resolve a field's textual value (number or three-letter alias) into a
   * number within the field's range.
   */
  private static parseValue(token: string, definition: FieldDefinition, expression: string): number {
    let value: number | undefined;

    if (definition.aliases) {
      value = definition.aliases[token.toLowerCase()];
    }

    if (value === undefined && /^\d+$/.test(token)) {
      value = Number(token);
    }

    if (value === undefined) {
      throw new Error(`Invalid cron expression [${expression}]: unknown value [${token}] in ${definition.name} field.`);
    }

    if (value < definition.min || value > definition.max) {
      throw new Error(
        `Invalid cron expression [${expression}]: ${definition.name} value [${value}] out of range ` +
          `[${definition.min}-${definition.max}].`
      );
    }

    return CronExpression.normalizeValue(value, definition);
  }

  /** Sunday `7` and Monday `0`-wrapping for the day-of-week field */
  private static normalizeValue(value: number, definition: FieldDefinition): number {
    if (definition === WEEKDAY_FIELD && value === 7) {
      return 0;
    }

    return value;
  }

  /**
   * Parse one comma-separated field into the set of values it allows.
   */
  private static parseField(field: string, definition: FieldDefinition, expression: string): ParsedField {
    const values = new Set<number>();
    let wildcard = true;

    for (const item of field.split(',')) {
      const match = /^(\*|[^,/]+?)(?:\/(\d+))?$/.exec(item);

      if (!match) {
        throw new Error(`Invalid cron expression [${expression}]: cannot parse [${item}] in ${definition.name} field.`);
      }

      const [, target, stepText] = match;
      const step = stepText === undefined ? 1 : Number(stepText);

      if (step < 1) {
        throw new Error(`Invalid cron expression [${expression}]: step [${stepText}] must be at least 1.`);
      }

      if (target === '*') {
        // `*/n` is still a restricted field; only a bare `*` is unrestricted.
        if (stepText !== undefined) {
          wildcard = false;
        }

        CronExpression.fillRange(values, definition.min, definition.max, step, definition);

        continue;
      }

      wildcard = false;

      let low: number;
      let high: number;

      if (target.includes('-')) {
        const [lowToken, highToken] = target.split('-');

        if (highToken === undefined || highToken.includes('-')) {
          throw new Error(
            `Invalid cron expression [${expression}]: cannot parse range [${target}] in ${definition.name} field.`
          );
        }

        low = CronExpression.parseValue(lowToken, definition, expression);
        high = CronExpression.parseValue(highToken, definition, expression);

        if (low > high) {
          throw new Error(
            `Invalid cron expression [${expression}]: ${definition.name} range [${low}-${high}] start exceeds end.`
          );
        }
      } else {
        low = CronExpression.parseValue(target, definition, expression);
        // `5/15` means "from 5 to the end of the field, every 15th".
        high = stepText === undefined ? low : definition.max;
      }

      CronExpression.fillRange(values, low, high, step, definition);
    }

    return { wildcard, values };
  }

  private static fillRange(
    values: Set<number>,
    low: number,
    high: number,
    step: number,
    definition: FieldDefinition
  ): void {
    for (let value = low; value <= high; value += step) {
      values.add(CronExpression.normalizeValue(value, definition));
    }
  }
}
