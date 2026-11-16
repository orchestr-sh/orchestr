/**
 * Test Clock
 *
 * Runner-agnostic time travel: `travelTo`, `travel`, `freezeTime` and
 * `travelBack` swap the global `Date` for a subclass whose "now" comes from
 * this clock, so any code that reads the time through `Date.now()` or
 * `new Date()` - cache expiries, session lifetimes, the scheduler - sees the
 * travelled moment without the test framework depending on Vitest's fake
 * timers.
 *
 * Mirrors the Illuminate\Foundation\Testing\Concerns\InteractsWithTime
 * helpers (`travel`, `travelTo`, `travelBack`, `freezeTime`).
 *
 * @example
 * ```typescript
 * travelTo(new Date('2030-01-01T00:00:00Z'));
 * Date.now(); // 1893456000000
 * travel(3600); // one hour later
 * travelBack(); // the real Date is restored
 * ```
 */

/** The genuine Date constructor, captured before any patching */
const RealDate = Date;

/**
 * Anything that can name an instant: a Date, an ISO string or epoch ms.
 */
export type TimeLike = Date | string | number;

/**
 * Resolve an instant to epoch milliseconds
 */
function toMillis(value: TimeLike): number {
  if (value instanceof RealDate) {
    return value.getTime();
  }

  if (typeof value === 'number') {
    return value;
  }

  const parsed = new RealDate(value).getTime();

  if (Number.isNaN(parsed)) {
    throw new Error(`Unable to interpret [${String(value)}] as a moment in time.`);
  }

  return parsed;
}

class TestClock {
  /**
   * The module-level singleton the patched Date consults (assigned below);
   * referenced instead of `this` inside the faked constructor.
   */
  static instance: TestClock;
  /**
   * Offset in milliseconds added to the real clock while travelling
   */
  private offsetMs: number = 0;

  /**
   * When set, `now()` returns this frozen instant instead of moving
   */
  private frozenAt: number | null = null;

  /**
   * Whether the global Date is currently patched
   */
  private patched: boolean = false;

  /**
   * The instant the clock currently reports (real time when unpatched)
   */
  now(): number {
    if (!this.patched) {
      return RealDate.now();
    }

    return this.frozenAt !== null ? this.frozenAt : RealDate.now() + this.offsetMs;
  }

  /**
   * Set the clock to an absolute moment; time keeps flowing from there
   * unless it is frozen afterwards
   * Laravel: $this->travelTo($date)
   */
  travelTo(moment: TimeLike): void {
    this.install();

    const target = toMillis(moment);

    this.frozenAt = null;
    this.offsetMs = target - RealDate.now();
  }

  /**
   * Move the clock a number of seconds forwards (or backwards when
   * negative), relative to wherever it currently stands
   * Laravel: $this->travel($seconds)
   */
  travel(seconds: number): void {
    this.install();

    if (this.frozenAt !== null) {
      this.frozenAt += seconds * 1000;
      return;
    }

    this.offsetMs += seconds * 1000;
  }

  /**
   * Pin the clock at the current (possibly travelled) instant
   * Laravel: $this->freezeTime()
   */
  freeze(): void {
    this.install();

    const instant = this.now();

    this.frozenAt = instant;
    this.offsetMs = instant - RealDate.now();
  }

  /**
   * Return to the real clock
   * Laravel: $this->travelBack()
   */
  travelBack(): void {
    this.offsetMs = 0;
    this.frozenAt = null;

    if (this.patched) {
      Object.defineProperty(globalThis, 'Date', {
        value: RealDate,
        writable: true,
        configurable: true,
        enumerable: true,
      });

      this.patched = false;
    }
  }

  /**
   * Whether the clock is currently travelling/frozen
   */
  isTravelled(): boolean {
    return this.patched;
  }

  /**
   * Swap the global Date for the faked subclass, once
   */
  private install(): void {
    if (this.patched) {
      return;
    }

    class FakedDate extends RealDate {
      constructor(...args: any[]) {
        if (args.length === 0) {
          super(currentClock.now());
        } else if (args.length === 1) {
          super(args[0]);
        } else {
          super(args[0], args[1], args[2], args[3], args[4], args[5], args[6]);
        }
      }

      static override now(): number {
        return currentClock.now();
      }

      // Instances created before the patch stay `instanceof Date`, and
      // faked instances are plain Dates too - the patch is invisible to
      // type checks.
      static override [Symbol.hasInstance](instance: any): boolean {
        return instance instanceof RealDate;
      }
    }

    Object.defineProperty(FakedDate, 'name', { value: 'Date', configurable: true });

    Object.defineProperty(globalThis, 'Date', {
      value: FakedDate,
      writable: true,
      configurable: true,
      enumerable: true,
    });

    this.patched = true;
  }
}

/**
 * The process-wide test clock
 */
export const clock = new TestClock();

TestClock.instance = clock;

/**
 * Short alias used by the faked Date implementation
 */
const currentClock = clock;

/**
 * Set the clock to an absolute moment
 * Laravel: $this->travelTo($date)
 */
export function travelTo(moment: TimeLike): void {
  clock.travelTo(moment);
}

/**
 * Move the clock a number of seconds forwards or backwards
 * Laravel: $this->travel($seconds)
 */
export function travel(seconds: number): void {
  clock.travel(seconds);
}

/**
 * Pin the clock at the current instant
 * Laravel: $this->freezeTime()
 */
export function freezeTime(): void {
  clock.freeze();
}

/**
 * Restore the real clock
 * Laravel: $this->travelBack()
 */
export function travelBack(): void {
  clock.travelBack();
}

/**
 * The instant the clock currently reports
 * Laravel: Carbon::now()
 */
export function clockNow(): Date {
  return new Date(clock.now());
}
