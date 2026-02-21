/**
 * MakeJobCommand
 *
 * Create a new job class.
 * Mirrors Laravel's `php artisan make:job`.
 */

import { Command, CommandOptions } from '@/Console/Command';
import { Application } from '@/Foundation/Application';
import * as fs from 'fs/promises';
import * as path from 'path';

export class MakeJobCommand extends Command {
  signature = 'make:job <name>';
  description = 'Create a new job class';

  constructor(protected app: Application) {
    super();
  }

  async handle(args: string[], options: CommandOptions): Promise<void> {
    const name = args[0];

    if (!name) {
      this.error('Job name is required.');
      this.line('Usage: make:job <name>');
      return;
    }

    const jobsPath = this.getPath(options);
    const filePath = path.join(jobsPath, `${name}.ts`);

    // Check if file already exists
    if (await this.fileExists(filePath)) {
      this.error(`Job already exists: ${filePath}`);
      return;
    }

    // Create directory if it doesn't exist
    await fs.mkdir(jobsPath, { recursive: true });

    // Determine if sync or queued
    const sync = options.sync === true || options.sync === 'true';

    // Generate file content
    const content = (sync ? this.getSyncStub() : this.getStub()).replace(/\{\{className\}\}/g, name);

    // Write file
    await fs.writeFile(filePath, content);

    this.info(`Job created successfully: ${filePath}`);
    this.newLine();
    this.comment('Next steps:');
    this.comment('1. Add your job logic to the handle() method');
    this.comment('2. Dispatch the job:');
    this.comment(`   await ${name}.dispatch();`);
  }

  protected getPath(options: CommandOptions): string {
    return (options.path as string) || this.app.path('Jobs');
  }

  protected async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  protected getStub(): string {
    return `import { Job } from '@orchestr-sh/orchestr';

export class {{className}} extends Job {
  /**
   * The number of times the job may be attempted.
   */
  public tries = 3;

  /**
   * The number of seconds the job can run before timing out.
   */
  public timeout = 60;

  /**
   * The number of seconds to wait before retrying the job.
   * Can use an array for progressive backoff: [10, 30, 60]
   */
  public backoff = 10;

  /**
   * Create a new job instance.
   */
  constructor(
    // Add your job data here
  ) {
    super();
  }

  /**
   * Execute the job.
   */
  async handle(): Promise<void> {
    //
  }

  /**
   * Handle a job failure.
   */
  async failed(error: Error): Promise<void> {
    console.error(\`[\${this.displayName()}] Failed:\`, error.message);
  }
}
`;
  }

  protected getSyncStub(): string {
    return `import { Job } from '@orchestr-sh/orchestr';

export class {{className}} extends Job {
  /**
   * Create a new job instance.
   */
  constructor(
    // Add your job data here
  ) {
    super();
  }

  /**
   * Execute the job.
   */
  async handle(): Promise<void> {
    //
  }
}
`;
  }
}
