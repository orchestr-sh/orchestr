/**
 * MakeViewCommand
 *
 * Create a new view file.
 * Mirrors Laravel's `php artisan make:view`.
 */

import { Command, CommandOptions } from '@/Console/Command';
import { Application } from '@/Foundation/Application';
import * as fs from 'fs/promises';
import * as path from 'path';

export class MakeViewCommand extends Command {
  signature = 'make:view <name>';
  description = 'Create a new view file';

  constructor(protected app: Application) {
    super();
  }

  async handle(args: string[], options: CommandOptions): Promise<void> {
    const name = args[0];

    if (!name) {
      this.error('View name is required.');
      this.line('Usage: make:view <name>');
      return;
    }

    const viewsPath = this.getViewsPath(options);

    // Convert dot-notation to directory path: 'layouts.app' -> 'layouts/app'
    const relativePath = name.replace(/\./g, '/');
    const ext = (options.ext as string) || '.html';
    const fileName = relativePath + ext;
    const filePath = path.join(viewsPath, fileName);
    const dirPath = path.dirname(filePath);

    // Check if file already exists
    if (await this.fileExists(filePath)) {
      this.error(`View already exists: ${filePath}`);
      return;
    }

    // Create directory if it doesn't exist
    await fs.mkdir(dirPath, { recursive: true });

    // Determine the view name for the title
    const viewTitle = name
      .split('.')
      .pop()!
      .replace(/-/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());

    // Generate file content
    const content = this.getStub(viewTitle);

    // Write file
    await fs.writeFile(filePath, content);

    this.info(`View created successfully: ${filePath}`);
    this.newLine();
    this.comment('Render it in a route:');
    this.comment(`  return view('${name}', { title: '${viewTitle}' });`);
  }

  protected getViewsPath(options: CommandOptions): string {
    if (options.path) {
      return options.path as string;
    }

    // Resolve from ViewFactory if available
    try {
      const factory = this.app.make('view') as any;
      const paths: string[] = factory.getPaths?.() ?? [];
      if (paths.length > 0) {
        return paths[0];
      }
    } catch {
      // ViewFactory not registered yet
    }

    return path.join(this.app.getBasePath(), 'resources', 'views');
  }

  protected async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  protected getStub(title: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{ title }}</title>
</head>
<body>
  <h1>{{ title }}</h1>
</body>
</html>
`;
  }
}
