/**
 * ScheduleListCommand
 *
 * Lists every registered scheduled task with its cron expression and
 * next run time. Mirrors Laravel's `php artisan schedule:list`.
 */

import { Command, CommandOptions } from '@/Console/Command';
import { Application } from '@/Foundation/Application';
import { CronExpression } from '@/Scheduling/CronExpression';
import { resolveSchedule, type Schedule } from '@/Scheduling/Schedule';

export class ScheduleListCommand extends Command {
  signature = 'schedule:list [--timezone=TIMEZONE]';
  description = 'List all scheduled tasks with their next run times';

  constructor(protected app: Application) {
    super();
  }

  async handle(_args: string[], options: CommandOptions): Promise<void> {
    const schedule: Schedule = resolveSchedule(this.app);

    if (schedule.events.length === 0) {
      this.comment('No scheduled tasks have been defined.');

      return;
    }

    const now = new Date();
    const timezoneOverride = typeof options.timezone === 'string' ? options.timezone : undefined;

    for (const event of schedule.events) {
      const next = event.nextRunDate(now);
      const timezone = timezoneOverride ?? event.getTimezone();
      const nextRun = next ? CronExpression.format(next, timezone) : 'never';

      this.line(
        `${event.getExpression()}  ${event.getDescription()}  next run date[${nextRun}]${timezone ? ` (${timezone})` : ''}`
      );
    }
  }
}
