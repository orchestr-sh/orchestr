/**
 * MakeListenerCommand
 *
 * Create a new event listener class following Laravel's Artisan pattern
 */

import { Command, CommandOptions } from '@/Console/Command';
import { Application } from '@/Foundation/Application';
import * as fs from 'fs/promises';
import * as path from 'path';

export class MakeListenerCommand extends Command {
  signature = 'make:listener <name> [--event=] [--queued]';
  description = 'Create a new event listener class';

  constructor(protected app: Application) {
    super();
  }

  async handle(args: string[], options: CommandOptions): Promise<void> {
    const name = args[0];

    if (!name) {
      this.error('Listener name is required.');
      this.line('Usage: make:listener <name> [--event=EventName] [--queued]');
      return;
    }

    const event = options.event as string | undefined;
    const queued = options.queued === true;

    const listenersPath = this.getPath(options);
    const filePath = path.join(listenersPath, `${name}.ts`);

    // Check if file already exists
    if (await this.fileExists(filePath)) {
      this.error(`Listener already exists: ${filePath}`);
      return;
    }

    // Create directory if it doesn't exist
    await fs.mkdir(listenersPath, { recursive: true });

    // Generate file content
    const content = this.getStub(queued, event)
      .replace(/\{\{className\}\}/g, name)
      .replace(/\{\{eventClass\}\}/g, event || 'Event');

    // Write file
    await fs.writeFile(filePath, content);

    this.info(`Listener created successfully: ${filePath}`);

    if (event) {
      this.newLine();
      this.comment("Don't forget to register this listener in your EventServiceProvider:");
      this.comment(`  protected listen = {`);
      this.comment(`    ${event}: '${name}',`);
      this.comment(`  }`);
    } else {
      this.newLine();
      this.comment('Remember to specify the event type in the handle method.');
    }
  }

  /**
   * Get the destination path for the listener class
   */
  protected getPath(options: CommandOptions): string {
    return (options.path as string) || this.app.path('Listeners');
  }

  /**
   * Check if a file exists
   */
  protected async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the stub template for the listener class
   */
  protected getStub(queued: boolean, event?: string): string {
    if (queued) {
      return `import { ShouldQueue } from '../../Listeners/Contracts/ShouldQueue';${event ? `\nimport { ${event} } from '../Events/${event}';` : ''}

/**
 * {{className}} Listener
 *
 * This listener will be queued automatically
 */
export class {{className}} implements ShouldQueue {
  // Queue configuration
  public connection = 'default';
  public queue = 'listeners';
  public tries = 3;

  /**
   * Handle the event
   */
  async handle(event: {{eventClass}}): Promise<void> {
    // Handle the event
  }

  /**
   * Handle a job failure
   */
  async failed(event: {{eventClass}}, error: Error): Promise<void> {
    // Handle the failure
  }
}
`;
    }

    return `${event ? `import { ${event} } from '../Events/${event}';\n\n` : ''}/**
 * {{className}} Listener
 */
export class {{className}} {
  /**
   * Handle the event
   */
  handle(event: {{eventClass}}): void {
    // Handle the event
  }
}
`;
  }
}
