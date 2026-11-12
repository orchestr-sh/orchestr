/**
 * CallbackTask
 *
 * Wraps a plain closure scheduled with `Schedule.call()`. Mirrors
 * Laravel's `Illuminate\Console\Scheduling\CallbackEvent` command object.
 */

import type { ScheduledTask, TaskRunOptions } from '../Contracts/ScheduledTask';

export type ScheduleClosure = (now: Date) => unknown;

export class CallbackTask implements ScheduledTask {
  constructor(
    protected readonly callback: ScheduleClosure,
    public readonly description: string = 'Closure'
  ) {}

  async run(_options?: TaskRunOptions): Promise<void> {
    await this.callback(new Date());
  }
}
