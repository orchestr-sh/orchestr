/**
 * QueueListenCommand
 *
 * Start a queue worker loop for local development. Mirrors Laravel's
 * `php artisan queue:listen`: unlike `queue:work`, which caches code in a
 * single long-lived process, listen supervises `queue:work` child
 * processes and restarts them:
 *
 * - whenever the worker process exits (crash or `queue:restart` / SIGUSR2),
 *   with a one-second backoff when it dies almost immediately;
 * - when source files change, if `--watch[=dir,dir]` is given (the child
 *   is terminated and relaunched, re-loading application code).
 *
 * Because each iteration runs in a fresh child process, code changes picked
 * up via restarts are always reflected. Running a real supervisor with
 * restart-on-change through this command is intended for development;
 * production deployments should run `queue:work` under a process supervisor
 * (systemd, Docker, etc.).
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, watch, type FSWatcher } from 'node:fs';
import { resolve } from 'node:path';
import type { QueueManager } from '@/Queue/QueueManager';
import { Command, CommandOptions } from '@/Console/Command';
import { Application } from '@/Foundation/Application';

/** Options forwarded verbatim from queue:listen to the queue:work child */
const FORWARDED_OPTIONS = [
  'queue',
  'name',
  'sleep',
  'tries',
  'timeout',
  'memory',
  'max-jobs',
  'max-time',
  'force',
  'backoff',
  'rest',
];

export class QueueListenCommand extends Command {
  signature = 'queue:listen [connection]';
  description = 'Start a queue worker, restarting it on changes (development)';

  protected stopped: boolean = false;
  protected restartRequested: boolean = false;
  protected child: ChildProcess | null = null;
  protected watchers: FSWatcher[] = [];
  protected watchDebounce: ReturnType<typeof setTimeout> | null = null;
  protected signalCleanup: (() => void) | null = null;

  constructor(protected app: Application) {
    super();
  }

  async handle(args: string[], options: CommandOptions): Promise<void> {
    const manager = this.app.make<QueueManager>('queue');
    const connection = args[0] || manager.getDefaultConnection();

    const childArgv = this.buildChildArgv(process.argv, connection, options);
    const watchedDirs = this.resolveWatchDirs(options);

    this.info(
      `[${new Date().toISOString()}] Listening for jobs on [${connection}] connection` +
        (watchedDirs.length > 0 ? ` (watching: ${watchedDirs.join(', ')})` : '')
    );

    this.registerSignalHandlers();

    if (watchedDirs.length > 0) {
      this.startWatching(watchedDirs);
    }

    try {
      while (!this.stopped) {
        this.restartRequested = false;
        const startedAt = Date.now();

        const exitCode = await this.runChild(childArgv);

        if (this.stopped) {
          if (exitCode !== 0 && exitCode !== null) {
            this.comment(`Worker stopped with exit code ${exitCode}.`);
          }
          break;
        }

        const reason = this.restartRequested
          ? 'restart requested'
          : exitCode !== 0 && exitCode !== null
            ? `worker exited with code ${exitCode}`
            : 'worker exited';

        this.info(`[${new Date().toISOString()}] Restarting queue worker (${reason}).`);

        // Crash-loop guard: a child that dies almost immediately usually
        // indicates a configuration error; back off before respawning.
        if (Date.now() - startedAt < 1000) {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    } finally {
      this.cleanup();
    }

    this.info('Queue listener stopped.');
  }

  /**
   * Build the argv for the queue:work child process
   *
   * The CLI entry (`process.argv[1]`) is re-invoked, so the child runs the
   * same kernel the parent was started from. Embedders that launch the
   * kernel programmatically can point at their own runner with
   * `--command=/path/to/cli.mjs`.
   */
  buildChildArgv(argv: string[], connection: string, options: CommandOptions): string[] {
    const entry = typeof options.command === 'string' ? options.command : argv[1];

    if (!entry) {
      throw new Error(
        'Unable to determine the CLI entry to respawn. Run queue:listen through the orchestr ' +
          'CLI or pass --command=/path/to/your/cli.mjs.'
      );
    }

    const childArgs = ['queue:work', connection];

    for (const key of FORWARDED_OPTIONS) {
      const value = options[key];

      if (value === undefined || value === false) {
        continue;
      }

      childArgs.push(value === true ? `--${key}` : `--${key}=${String(value)}`);
    }

    return [entry, ...childArgs];
  }

  /**
   * Spawn the queue:work child and resolve with its exit code
   */
  protected runChild(childArgv: string[]): Promise<number | null> {
    return new Promise((resolvePromise) => {
      const child = spawn(process.execPath, childArgv, { stdio: 'inherit' });

      this.child = child;

      child.on('error', (error) => {
        this.error(`[queue:listen] Failed to start worker: ${(error as Error).message}`);
        this.child = null;
        resolvePromise(1);
      });

      child.on('exit', (code) => {
        this.child = null;
        resolvePromise(code);
      });
    });
  }

  /**
   * Resolve which directories to watch for restart-on-change
   */
  protected resolveWatchDirs(options: CommandOptions): string[] {
    const raw = options.watch;

    if (raw === undefined || raw === false || raw === 'false') {
      return [];
    }

    const dirs =
      raw === true
        ? ['src'] // development default
        : String(raw)
            .split(',')
            .map((dir) => dir.trim())
            .filter(Boolean);

    return dirs.map((dir) => resolve(process.cwd(), dir)).filter((dir) => existsSync(dir));
  }

  /**
   * Watch source directories; on change, terminate the worker so the
   * supervision loop relaunches it with fresh code.
   */
  protected startWatching(dirs: string[]): void {
    for (const dir of dirs) {
      try {
        const watcher = watch(dir, { recursive: true }, () => {
          this.scheduleRestart();
        });

        watcher.on('error', () => {
          // Watching is best-effort: an inotify limit or a deleted directory
          // must never crash the listener.
        });

        this.watchers.push(watcher);
      } catch {
        this.comment(`[queue:listen] Unable to watch [${dir}]; restart-on-change disabled for it.`);
      }
    }
  }

  /**
   * Debounced restart: file edits often arrive in bursts (formatter,
   * multi-file saves); a single worker restart covers them.
   */
  protected scheduleRestart(): void {
    if (this.watchDebounce !== null) {
      clearTimeout(this.watchDebounce);
    }

    this.watchDebounce = setTimeout(() => {
      this.watchDebounce = null;
      this.restartRequested = true;
      this.terminateChild('source files changed');
    }, 300);
  }

  /**
   * Ask the current worker to stop; the supervision loop respawns it
   */
  protected terminateChild(reason: string): void {
    if (this.child && !this.child.killed) {
      this.comment(`[queue:listen] Stopping worker: ${reason}.`);
      this.child.kill('SIGTERM');
    }
  }

  /**
   * SIGINT/SIGTERM stop the listener (and its child); SIGUSR2 (the
   * queue:restart signal) restarts the child while listening continues.
   */
  protected registerSignalHandlers(): void {
    const stop = () => {
      this.stopped = true;
      this.terminateChild('shutdown requested');
    };

    const restart = () => {
      this.restartRequested = true;
      this.terminateChild('restart signal received');
    };

    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    process.on('SIGUSR2', restart);

    this.signalCleanup = () => {
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
      process.removeListener('SIGUSR2', restart);
    };
  }

  /**
   * Remove signal handlers and close watchers
   */
  protected cleanup(): void {
    if (this.watchDebounce !== null) {
      clearTimeout(this.watchDebounce);
      this.watchDebounce = null;
    }

    for (const watcher of this.watchers) {
      try {
        watcher.close();
      } catch {
        // best effort
      }
    }

    this.watchers = [];
    this.signalCleanup?.();
    this.signalCleanup = null;
  }
}
