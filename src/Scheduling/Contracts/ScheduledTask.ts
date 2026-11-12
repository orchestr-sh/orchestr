/**
 * ScheduledTask Contract
 *
 * The single contract every schedulable unit satisfies: console commands,
 * queued jobs, shell commands, and plain closures all implement it, so the
 * scheduling Event only ever talks to this interface.
 *
 * Mirrors Laravel's `Illuminate\Contracts\Console\UnsparseKernel`-adjacent
 * `DisplayableCommand` + runnable closure behaviour folded into one type.
 */

/** Context handed to a task when its owning Event runs it */
export interface TaskRunOptions {
  /** True when the Event is configured with `runInBackground()` */
  background?: boolean;
}

export interface ScheduledTask {
  /**
   * Human-readable description used by `schedule:list`, the mutex key,
   * and failure reporting.
   */
  readonly description: string;

  /**
   * Execute the task. A rejected promise (or thrown error) marks the
   * scheduled run as failed, firing the Event's `onFailure` callbacks.
   */
  run(options?: TaskRunOptions): Promise<void>;
}
