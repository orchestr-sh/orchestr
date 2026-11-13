/**
 * Schedule
 *
 * The task scheduler manager. Mirrors `Illuminate\Console\Scheduling\Schedule`:
 * register recurring work once, then let a single cron entry point at
 * `schedule:run` (or the `schedule:work` loop) fire whatever is due.
 *
 * Every registration method returns the fluent `Event` so timing and
 * modifiers can be chained:
 *
 * @example
 * ```typescript
 * const schedule = app.make<Schedule>('schedule');
 *
 * schedule.command('report:send --daily').dailyAt('09:00').onOneServer();
 * schedule.job(new PruneOldRecords()).weeklyOn(0, '02:00');
 * schedule.call(() => refreshCaches(), 'refresh caches').everyFifteenMinutes();
 * schedule.exec('php runc.php').hourly();
 *
 * // From one crontab line:
 * //   * * * * * orchestr schedule:run
 * ```
 */

import { existsSync } from 'node:fs';
import type { Application } from '@/Foundation/Application';
import type { Job } from '@/Queue/Job';
import { CacheManager } from '@/Cache/CacheManager';
import { ArrayStore } from '@/Cache/Stores/ArrayStore';
import type { ScheduledTask } from './Contracts/ScheduledTask';
import { CacheEventMutex, type Locker } from './CacheEventMutex';
import { Event, type EventRunOutcome } from './Event';
import { CallbackTask, type ScheduleClosure } from './Tasks/CallbackTask';
import { ConsoleCommandTask } from './Tasks/ConsoleCommandTask';
import { ExecTask } from './Tasks/ExecTask';
import { JobTask, type ScheduledJobClass } from './Tasks/JobTask';

/** A command-line option value accepted by `Schedule.command()` */
export type CommandParameter = string | number | boolean | undefined;

/** One entry per event `Schedule.run()` awaited */
export interface EventRunResult {
  event: Event;
  outcome: EventRunOutcome;
}

export class Schedule {
  // Day-of-week constants, mirroring Laravel's Schedule constants.
  static readonly SUNDAY = 0;
  static readonly MONDAY = 1;
  static readonly TUESDAY = 2;
  static readonly WEDNESDAY = 3;
  static readonly THURSDAY = 4;
  static readonly FRIDAY = 5;
  static readonly SATURDAY = 6;
  static readonly WEEKDAYS = [1, 2, 3, 4, 5];
  static readonly WEEKENDS = [0, 6];

  /** All events registered with this schedule */
  readonly events: Event[] = [];

  protected mutex?: CacheEventMutex;

  /**
   * Process-wide fallback locker so schedules built without an
   * application still share one cache-backed mutex.
   */
  private static fallbackLocker?: CacheManager;

  constructor(public readonly app?: Application) {}

  /**
   * The locker used when the application has no cache binding: an
   * array-store cache manager shared by every app-less Schedule.
   */
  protected static getFallbackLocker(): CacheManager {
    if (!Schedule.fallbackLocker) {
      const prefix = 'orchestr_scheduling_';
      const manager = new CacheManager({
        default: 'array',
        prefix,
        stores: { array: { driver: 'array', serialize: false } },
      });

      manager.registerDriver('array', (config) => new ArrayStore(config, prefix));
      Schedule.fallbackLocker = manager;
    }

    return Schedule.fallbackLocker;
  }

  // --- Registration ---

  /**
   * Schedule a closure
   */
  call(callback: ScheduleClosure, description?: string): Event {
    return this.addEvent(new CallbackTask(callback, description));
  }

  /**
   * Schedule a console command. Parameters are appended to the command
   * line the way Artisan would receive them (`--key=value`, `--flag`).
   */
  command(command: string, parameters?: Record<string, CommandParameter>, description?: string): Event {
    return this.addEvent(new ConsoleCommandTask(this.app, this.buildCommandString(command, parameters)), description);
  }

  /**
   * Schedule a queued job. Either pass a ready job instance, or the job
   * class plus constructor arguments to build a fresh one each run.
   */
  job(job: Job | ScheduledJobClass, args: any[] = [], description?: string): Event {
    return this.addEvent(new JobTask(this.app, job, args), description);
  }

  /**
   * Schedule a shell command
   */
  exec(command: string, description?: string): Event {
    return this.addEvent(new ExecTask(command, this.app?.getBasePath()), description);
  }

  /**
   * Register a group of events with a temporary schedule and merge the
   * results into this one. Mirrors Laravel's `Schedule::group()`.
   */
  group(callback: (schedule: Schedule) => void): this {
    const group = new Schedule(this.app);

    callback(group);

    this.events.push(...group.events);

    return this;
  }

  protected addEvent(task: ScheduledTask, name?: string): Event {
    const event = new Event(task, this, name);

    this.events.push(event);

    return event;
  }

  // --- Execution ---

  /**
   * The events whose expressions and filters pass at the given moment
   */
  dueEvents(now: Date = new Date()): Event[] {
    return this.events.filter((event) => event.isDue(now));
  }

  /**
   * Run every due event. Events with `runInBackground()` are started but
   * not awaited, so they never block the rest of the minute; results are
   * returned for the events this call awaited.
   */
  async run(now: Date = new Date()): Promise<EventRunResult[]> {
    const results: EventRunResult[] = [];
    const maintenance = this.inMaintenanceMode();

    for (const event of this.dueEvents(now)) {
      if (maintenance && !event.runsEvenInMaintenanceMode()) {
        continue;
      }

      const run = event.run();

      if (event.isRunInBackground()) {
        // Keep the promise alive so an unhandled rejection never escapes
        // the fire-and-forget path; failures surface via onFailure.
        void run.catch(() => undefined);
        continue;
      }

      results.push({ event, outcome: await run });
    }

    return results;
  }

  // --- Infrastructure ---

  /**
   * The cache-backed mutex protecting withoutOverlapping/onOneServer
   */
  getMutex(): CacheEventMutex {
    if (!this.mutex) {
      this.mutex = new CacheEventMutex(this.getLocker());
    }

    return this.mutex;
  }

  /**
   * Whether the application is in maintenance mode. Matches Laravel's
   * `php artisan down` contract: the presence of
   * `storage/framework/down`.
   */
  inMaintenanceMode(): boolean {
    if (!this.app) {
      return false;
    }

    try {
      return existsSync(this.app.storagePath('framework/down'));
    } catch {
      return false;
    }
  }

  /**
   * The locker for mutexes: the application cache when available, a
   * shared in-memory cache store otherwise.
   */
  protected getLocker(): Locker {
    if (this.app?.bound('cache')) {
      try {
        return this.app.make<Locker>('cache');
      } catch {
        // fall through to the process-wide default
      }
    }

    return Schedule.getFallbackLocker();
  }

  /**
   * Build the full command line from the base string and Artisan-style
   * parameters.
   */
  protected buildCommandString(command: string, parameters?: Record<string, CommandParameter>): string {
    if (!parameters) {
      return command;
    }

    const tokens = [command];

    for (const [key, value] of Object.entries(parameters)) {
      if (value === undefined || value === false) {
        continue;
      }

      tokens.push(value === true ? `--${key}` : `--${key}=${value}`);
    }

    return tokens.join(' ');
  }
}

/**
 * Resolve the application's schedule, creating a singleton instance on
 * demand so `schedule:*` commands work even when no ScheduleServiceProvider
 * was registered (mirrors Laravel's container resolution of Schedule).
 */
export function resolveSchedule(app: Application): Schedule {
  if (!app.bound('schedule')) {
    app.instance('schedule', new Schedule(app));
  }

  return app.make<Schedule>('schedule');
}
