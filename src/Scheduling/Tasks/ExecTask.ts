/**
 * ExecTask
 *
 * Runs a shell command when the scheduled Event fires. Mirrors Laravel's
 * `Schedule::exec()`: foreground runs wait for the process and treat a
 * non-zero exit code as a failure; background runs detach so other due
 * events are not blocked.
 */

import { exec, spawn } from 'node:child_process';
import type { ScheduledTask, TaskRunOptions } from '../Contracts/ScheduledTask';

export class ExecTask implements ScheduledTask {
  /** Captured stdout+stderr of the most recent foreground run */
  public lastOutput = '';

  constructor(
    protected readonly command: string,
    protected readonly cwd?: string
  ) {}

  get description(): string {
    return `Exec "${this.command}"`;
  }

  async run(options?: TaskRunOptions): Promise<void> {
    if (options?.background) {
      // Fire-and-forget: the child survives this process' event loop turn.
      const child = spawn(this.command, { shell: true, cwd: this.cwd, detached: true, stdio: 'ignore' });
      child.on('error', () => {
        // Nothing to await; a spawn failure simply never runs the command.
      });
      child.unref();

      return;
    }

    return new Promise<void>((resolve, reject) => {
      exec(this.command, { cwd: this.cwd }, (error, stdout, stderr) => {
        this.lastOutput = `${stdout}${stderr}`.trim();

        if (error) {
          reject(new Error(`Exec command [${this.command}] failed: ${this.lastOutput || error.message}`));

          return;
        }

        resolve();
      });
    });
  }
}
