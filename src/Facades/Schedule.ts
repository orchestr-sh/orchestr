/**
 * Schedule Facade
 *
 * Provides static access to the task scheduler.
 *
 * @example
 * ```typescript
 * import { Schedule } from '@orchestr-sh/orchestr';
 *
 * Schedule.command('report:send').dailyAt('09:00').withoutOverlapping();
 * Schedule.job(new PruneOldRecords()).weekly();
 *
 * const due = Schedule.dueEvents();
 * ```
 */

import type { Schedule as ScheduleManager } from '@/Scheduling/Schedule';
import { Facade } from '@/Support/Facade';

class ScheduleFacadeClass extends Facade {
  protected static getFacadeAccessor(): string {
    return 'schedule';
  }
}

export const Schedule = new Proxy(ScheduleFacadeClass, {
  get(target, prop) {
    // First check if it's a static method on the facade class itself
    if (prop in target) {
      const value = (target as any)[prop];
      if (typeof value === 'function') {
        return value.bind(target);
      }
      return value;
    }

    // Then try to get from the facade root (the Schedule manager instance)
    try {
      const root = (target as any).getFacadeRoot() as ScheduleManager;
      if (root && prop in root) {
        const value = (root as any)[prop];
        if (typeof value === 'function') {
          return (...args: any[]) => value.apply(root, args);
        }
        return value;
      }
    } catch (error) {
      // Facade root not available yet
    }

    return undefined;
  },
}) as unknown as typeof ScheduleFacadeClass & ScheduleManager;
