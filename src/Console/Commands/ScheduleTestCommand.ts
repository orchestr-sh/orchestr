/**
 * ScheduleTestCommand
 *
 * Runs a single scheduled task immediately, regardless of whether it
 * is due. Mirrors Laravel's `php artisan schedule:test`, whose
 * interactive choice list is replaced by a task search argument.
 */

import { Command, CommandOptions } from '@/Console/Command';
import { Application } from '@/Foundation/Application';
import { resolveSchedule, type Schedule } from '@/Scheduling/Schedule';

export class ScheduleTestCommand extends Command {
  signature = 'schedule:test [task]';
  description = 'Run a specific scheduled task immediately';

  constructor(protected app: Application) {
    super();
  }

  async handle(args: string[], _options: CommandOptions): Promise<void> {
    const schedule: Schedule = resolveSchedule(this.app);
    const search = args.join(' ').trim();

    if (!search) {
      this.listCandidates(schedule);

      return;
    }

    const matches = schedule.events.filter(
      (event) => event.getDescription().includes(search) || event.getExpression() === search
    );

    if (matches.length === 0) {
      this.error(`The schedule does not contain a task matching [${search}].`);

      return;
    }

    if (matches.length > 1) {
      this.error(`Multiple scheduled tasks match [${search}]. Be more specific:`);

      for (const event of matches) {
        this.comment(`  ${event.getExpression()}  ${event.getDescription()}`);
      }

      return;
    }

    const event = matches[0];

    this.info(`Running [${event.getDescription()}]...`);

    const outcome = await event.run();

    if (outcome.status === 'failure') {
      const message = outcome.error instanceof Error ? outcome.error.message : String(outcome.error);

      this.error(`Task failed: ${message}`);

      return;
    }

    if (outcome.status === 'skipped') {
      this.warn('Task did not run: its cache mutex is currently held by another process.');

      return;
    }

    this.info('Task completed.');
  }

  /**
   * No search given: show what could be run, like Laravel's choice list.
   */
  protected listCandidates(schedule: Schedule): void {
    if (schedule.events.length === 0) {
      this.comment('No scheduled tasks have been defined.');

      return;
    }

    this.question('Which scheduled task would you like to run? Pass it to the command:');

    for (const event of schedule.events) {
      this.comment(`  ${event.getExpression()}  ${event.getDescription()}`);
    }
  }
}
