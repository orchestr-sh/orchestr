/**
 * MakeEventCommand
 *
 * Create a new event class following Laravel's Artisan pattern
 */

import { Command, CommandOptions } from '../Command';
import { Application } from '../../Foundation/Application';
import * as fs from 'fs/promises';
import * as path from 'path';

export class MakeEventCommand extends Command {
  signature = 'make:event <name>';
  description = 'Create a new event class';

  constructor(protected app: Application) {
    super();
  }

  async handle(args: string[], options: CommandOptions): Promise<void> {
    const name = args[0];

    if (!name) {
      this.error('Event name is required.');
      this.line('Usage: make:event <name>');
      return;
    }

    const eventsPath = this.getPath(options);
    const filePath = path.join(eventsPath, `${name}.ts`);

    // Check if file already exists
    if (await this.fileExists(filePath)) {
      this.error(`Event already exists: ${filePath}`);
      return;
    }

    // Create directory if it doesn't exist
    await fs.mkdir(eventsPath, { recursive: true });

    // Generate file content
    const content = this.getStub()
      .replace(/\{\{className\}\}/g, name);

    // Write file
    await fs.writeFile(filePath, content);

    this.info(`Event created successfully: ${filePath}`);
    this.newLine();
    this.comment('Next steps:');
    this.comment('1. Add properties to the event constructor');
    this.comment(`2. Create a listener with: make:listener <name> --event=${name}`);
  }

  /**
   * Get the destination path for the event class
   */
  protected getPath(options: CommandOptions): string {
    return (options.path as string) || this.app.path('Events');
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
   * Get the stub template for the event class
   */
  protected getStub(): string {
    return `/**
 * {{className}} Event
 *
 * This event is dispatched when...
 */
export class {{className}} {
  constructor(
    // Add your event properties here
    // Example: public readonly user: User
  ) {}
}
`;
  }
}
