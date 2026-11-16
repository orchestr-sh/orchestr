/**
 * CacheCombinationCommand
 *
 * Shared plumbing for `optimize` and `optimize:clear`: both compose the
 * individual cache commands instead of reimplementing them (DRY), running
 * each one through the console kernel when it is available so the active
 * style, verbosity, and validation apply uniformly. Steps whose service is
 * not registered are skipped with a comment instead of failing the run -
 * an app without views has nothing to compile, and Laravel's optimize
 * likewise tolerates steps that do not apply.
 */

import type { ConsoleKernel } from '@/Console/ConsoleKernel';
import { Command, CommandOptions } from '@/Console/Command';
import { Application } from '@/Foundation/Application';

/** One composed step: its command name, required binding, and factory. */
export interface CombinationStep {
  name: string;
  /** Container binding the step needs; undefined when it always applies. */
  requires?: string;
  create: () => Command;
}

export abstract class CacheCombinationCommand extends Command {
  constructor(protected app: Application) {
    super();
  }

  /** The ordered steps this combination runs. */
  protected abstract steps(): CombinationStep[];

  async handle(_args: string[] = [], options: CommandOptions = {}): Promise<void> {
    await this.app.boot();

    for (const step of this.steps()) {
      if (step.requires !== undefined && !this.app.bound(step.requires)) {
        this.comment(`Skipping [${step.name}]: the [${step.requires}] service is not registered.`);
        continue;
      }

      await this.run(step, options);
    }
  }

  /**
   * Dispatch through the kernel when the step is registered there, else
   * execute a fresh instance directly so the command also works in embedded
   * setups without a console kernel.
   */
  protected async run(step: CombinationStep, options: CommandOptions): Promise<void> {
    const kernel = this.registeredKernel(step.name);

    if (kernel !== null) {
      await kernel.handle(step.name, [], options);
      return;
    }

    await step.create().handle([], options);
  }

  private registeredKernel(commandName: string): ConsoleKernel | null {
    if (!this.app.bound('console')) {
      return null;
    }

    const kernel = this.app.make<ConsoleKernel>('console');

    return kernel.getCommands().has(commandName) ? kernel : null;
  }
}
