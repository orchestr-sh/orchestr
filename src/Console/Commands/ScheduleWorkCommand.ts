/**
 * ScheduleWorkCommand
 *
 * Starts a long-running loop that executes `schedule:run` behaviour
 * every minute, so deployments do not need a crontab entry. Mirrors
 * Laravel's `php artisan schedule:work`.
 */

import { Command, CommandOptions } from '@/Console/Command';
import { Application } from '@/Foundation/Application';
import { resolveSchedule, type Schedule } from '@/Scheduling/Schedule';

export class ScheduleWorkCommand extends Command {
  signature = 'schedule:work';
  description = 'Start a minute scheduler loop running the scheduled tasks';

  protected running = true;

  constructor(protected app: Application) {
    super();
  }

  /**
   * Signal the loop to stop after its current iteration
   */
  stop(): void {
    this.running = false;
  }

  async handle(_args: string[], _options: CommandOptions): Promise<void> {
    const schedule: Schedule = resolveSchedule(this.app);

    this.info('Running the scheduler every minute. Press Ctrl+C to stop.');

    while (this.running) {
      const startedAt = Date.now();

      for (const { event, outcome } of await schedule.run()) {
        if (outcome.status === 'failure') {
          const message = outcome.error instanceof Error ? outcome.error.message : String(outcome.error);

          this.error(`Scheduled task [${event.getDescription()}] failed: ${message}`);
        }
      }

      // Sleep in one-second chunks until the minute is up so stop() can
      // interrupt a long sleep quickly.
      while (this.running && Date.now() - startedAt < 60_000) {
        const remaining = 60_000 - (Date.now() - startedAt);

        await this.sleep(Math.min(1000, remaining));
      }
    }

    this.info('Scheduler work loop stopped.');
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
