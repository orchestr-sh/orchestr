/**
 * ScheduleRunCommand
 *
 * Run due scheduled tasks once - the single entry point a crontab line
 * is pointed at. Mirrors Laravel's `php artisan schedule:run`.
 */

import { Command, CommandOptions } from '@/Console/Command';
import { Application } from '@/Foundation/Application';
import { resolveSchedule, type Schedule } from '@/Scheduling/Schedule';

export class ScheduleRunCommand extends Command {
  signature = 'schedule:run';
  description = 'Run the scheduled commands';

  constructor(protected app: Application) {
    super();
  }

  async handle(_args: string[], _options: CommandOptions): Promise<void> {
    const schedule: Schedule = resolveSchedule(this.app);

    for (const { event, outcome } of await schedule.run()) {
      if (outcome.status === 'failure') {
        const message = outcome.error instanceof Error ? outcome.error.message : String(outcome.error);

        this.error(`Scheduled task [${event.getDescription()}] failed: ${message}`);
      }
    }
  }
}
