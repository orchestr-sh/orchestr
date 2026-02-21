/**
 * MakeControllerCommand
 *
 * Create a new controller class following Laravel's Artisan pattern
 */

import { Command, CommandOptions } from '../Command';
import { Application } from '../../Foundation/Application';
import * as fs from 'fs/promises';
import * as path from 'path';

export class MakeControllerCommand extends Command {
  signature = 'make:controller <name>';
  description = 'Create a new controller class';

  constructor(protected app: Application) {
    super();
  }

  async handle(args: string[], options: CommandOptions): Promise<void> {
    const name = args[0];

    if (!name) {
      this.error('Controller name is required.');
      this.line('Usage: make:controller <name>');
      return;
    }

    const controllersPath = this.getPath(options);
    const filePath = path.join(controllersPath, `${name}.ts`);

    // Check if file already exists
    if (await this.fileExists(filePath)) {
      this.error(`Controller already exists: ${filePath}`);
      return;
    }

    // Create directory if it doesn't exist
    await fs.mkdir(controllersPath, { recursive: true });

    // Ensure base Controller exists at app/Http/Controllers/Controller.ts
    await this.ensureBaseController(controllersPath);

    // Generate file content
    const content = this.getStub().replace(/\{\{className\}\}/g, name);

    // Write file
    await fs.writeFile(filePath, content);

    this.info(`Controller created successfully: ${filePath}`);
    this.newLine();
    this.comment('Use it in your routes or register in your HTTP layer.');
  }

  /**
   * Get the destination path for the controller class
   */
  protected getPath(options: CommandOptions): string {
    return (options.path as string) || this.app.path('Http/Controllers');
  }

  /**
   * Ensure the base Controller exists at app/Http/Controllers/Controller.ts
   */
  protected async ensureBaseController(controllersPath: string): Promise<void> {
    const basePath = path.join(controllersPath, 'Controller.ts');
    if (await this.fileExists(basePath)) {
      return;
    }
    await fs.writeFile(basePath, this.getBaseControllerStub());
    this.info(`Base controller created: ${basePath}`);
  }

  /**
   * Stub for the base Controller at app/Http/Controllers/Controller.ts
   */
  protected getBaseControllerStub(): string {
    return `/**
 * Base Controller
 *
 * All application controllers should extend this class.
 */

import { Controller as BaseController } from '@orchestr-sh/orchestr';

export class Controller extends BaseController {
  //
}
`;
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
   * Get the stub template for the controller class
   */
  protected getStub(): string {
    return `/**
 * {{className}} Controller
 *
 * Handle HTTP requests for...
 */

import { Controller } from './Controller';

export class {{className}} extends Controller {
  // Add your controller methods here
  // Example: index(), store(), show(), update(), destroy()
}
`;
  }
}
