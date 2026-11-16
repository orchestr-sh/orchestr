/**
 * InteractsWithTime
 *
 * Time control for test cases: travel to absolute or relative moments,
 * freeze the clock, and return to real time. The methods delegate to the
 * runner-agnostic Clock module, and teardown restores the real Date so a
 * test can never leak travelled time into the next one.
 *
 * Mirrors Illuminate\Foundation\Testing\Concerns\InteractsWithTime.
 */

import type { TimeLike } from '@/Testing/Clock';
import type { TestApplicationConstructor } from '@/Testing/contracts';
import { clock, freezeTime, travel as travelClock, travelBack as travelBackClock, travelTo } from '@/Testing/Clock';

export function InteractsWithTime<T extends TestApplicationConstructor>(Base: T) {
  abstract class InteractsWithTimeMixin extends Base {
    constructor(...args: any[]) {
      super(...args);

      // Return to the real clock whenever the test case flushes, so
      // travelled time can never leak into the next test
      this.beforeFlushing(() => travelBackClock());
    }

    /**
     * Set the clock to an absolute moment; time keeps flowing from there
     * Laravel: travelTo
     */
    travelTo(moment: TimeLike): this {
      travelTo(moment);

      return this;
    }

    /**
     * Move the clock seconds forwards (negative travels back)
     * Laravel: travel
     */
    travel(seconds: number): this {
      travelClock(seconds);

      return this;
    }

    /**
     * Pin the clock at the current instant
     * Laravel: freezeTime
     */
    freezeTime(): this {
      freezeTime();

      return this;
    }

    /**
     * Return to the real clock
     * Laravel: travelBack
     */
    travelBack(): this {
      travelBackClock();

      return this;
    }

    /**
     * Run a callback with the clock set to a moment, then restore
     * Laravel: TravelTo::with($date, fn)
     */
    async travelToFor<R>(moment: TimeLike, callback: () => R | Promise<R>): Promise<R> {
      const travelled = clock.isTravelled();
      const offsetNow = clock.now();

      travelTo(moment);

      try {
        return await callback();
      } finally {
        if (travelled) {
          travelTo(new Date(offsetNow));
        } else {
          travelBackClock();
        }
      }
    }
  }

  return InteractsWithTimeMixin;
}
