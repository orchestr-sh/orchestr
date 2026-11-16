/**
 * ServeCommand
 *
 * Start the framework's HTTP kernel on a host and port for local
 * development. Mirrors Laravel's `php artisan serve` - the framework's own
 * kernel rather than spawning `php -S`, since this port *is* the runtime.
 *
 * The command boots the application (providers register routes and
 * middleware), listens, and blocks until the server closes. SIGINT/SIGTERM -
 * or a programmatic `stop()` - shut the kernel down cleanly so `handle()`
 * resolves and the process can exit.
 */

import type { Server } from 'http';
import { Command, CommandOptions } from '@/Console/Command';
import { Application } from '@/Foundation/Application';
import { Kernel } from '@/Foundation/Http/Kernel';

export class ServeCommand extends Command {
  signature = 'serve {--host=127.0.0.1 : The host address to serve on} {--port=8000 : The port to serve on}';
  description = 'Serve the application on the local machine';

  private httpKernel: Kernel | null = null;
  private server: Server | null = null;

  constructor(protected app: Application) {
    super();
  }

  async handle(_args: string[] = [], options: CommandOptions = {}): Promise<void> {
    await this.app.boot();

    const host = this.readString(options.host, '127.0.0.1');
    const port = Number.parseInt(this.readString(options.port, '8000'), 10);

    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      this.error(`Invalid port [${String(options.port)}].`);
      return;
    }

    this.httpKernel = new Kernel(this.app);
    this.server = this.httpKernel.listen(port, host);

    this.info(`Orchestr development server started on http://${host}:${port}`);
    this.comment('Press Ctrl+C to stop the server.');

    // Keep the run honest for signal shutdowns and remove the handlers again
    // so a stopped serve (embedded use, tests) never leaks process listeners.
    const onSignal = () => {
      void this.stop();
    };

    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);

    try {
      await new Promise<void>((resolve) => {
        this.server?.once('close', () => resolve());
      });
    } finally {
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
      this.httpKernel = null;
      this.server = null;
    }

    this.newLine();
    this.comment('Development server stopped.');
  }

  /**
   * The active HTTP server, for embedders and tests that need to observe
   * the listening state.
   */
  getServer(): Server | null {
    return this.server;
  }

  /**
   * Stop the development server; the running `handle()` call resolves once
   * the listener has closed.
   */
  async stop(): Promise<void> {
    if (this.httpKernel !== null) {
      await this.httpKernel.close();
    }
  }

  private readString(value: unknown, fallback: string): string {
    if (typeof value === 'string' && value !== '') {
      return value;
    }

    return typeof value === 'number' && Number.isFinite(value) ? String(value) : fallback;
  }
}
