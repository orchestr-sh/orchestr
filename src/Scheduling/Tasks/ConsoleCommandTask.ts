/**
 * ConsoleCommandTask
 *
 * Runs an application console command when the scheduled Event fires.
 * Mirrors Laravel's `Illuminate\Console\Scheduling\Event` command tasks,
 * which shell out to Artisan; here the command is dispatched straight
 * through the container-bound ConsoleKernel.
 */

import type { CommandOptions } from '@/Console/Command';
import type { ConsoleKernel } from '@/Console/ConsoleKernel';
import type { Application } from '@/Foundation/Application';
import type { ScheduledTask, TaskRunOptions } from '../Contracts/ScheduledTask';

/**
 * Split a full command line (`name arg --option=value`) into the pieces
 * `ConsoleKernel.handle()` expects.
 */
export function parseCommandString(command: string): { name: string; args: string[]; options: CommandOptions } {
  const tokens = command.trim().split(/\s+/);
  const name = tokens.shift() ?? '';
  const args: string[] = [];
  const options: CommandOptions = {};

  for (const token of tokens) {
    if (token.startsWith('--')) {
      const [optionName, ...rest] = token.slice(2).split('=');
      options[optionName] = rest.length > 0 ? rest.join('=') : true;
    } else if (token.startsWith('-') && token.length > 1) {
      options[token.slice(1)] = true;
    } else {
      args.push(token);
    }
  }

  return { name, args, options };
}

export class ConsoleCommandTask implements ScheduledTask {
  constructor(
    protected readonly app: Application | undefined,
    protected readonly command: string
  ) {}

  get description(): string {
    return `Command "${this.command}"`;
  }

  async run(_options?: TaskRunOptions): Promise<void> {
    if (!this.app) {
      throw new Error(
        'Scheduled console commands require an application instance; construct the Schedule with the app.'
      );
    }

    if (!this.app.bound('console')) {
      throw new Error(
        'The console kernel is not bound in the container. Create the ConsoleKernel before scheduling console commands.'
      );
    }

    const kernel = this.app.make<ConsoleKernel>('console');
    const { name, args, options } = parseCommandString(this.command);

    await kernel.handle(name, args, options);
  }
}
