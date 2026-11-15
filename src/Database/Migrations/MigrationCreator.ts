/**
 * Create a new migration file
 *
 * The migration stubs themselves live in src/Console/stubs so every
 * generator - `make:migration`, and the one `make:model --migration`
 * spawns - renders from the same shared templates (DRY). A directory of
 * published stubs overrides them, matching Stub's contract.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Stub } from '@/Console/Generators/Stub';

export class MigrationCreator {
  constructor(protected customStubPath?: string) {}

  /**
   * Create a new migration file
   */
  async create(name: string, migrationPath: string, table?: string, create: boolean = false): Promise<string> {
    this.ensureMigrationDirectoryExists(migrationPath);

    const fileName = this.getDatePrefix() + '_' + name + '.ts';
    const filePath = path.join(migrationPath, fileName);

    const template = await Stub.load(this.stubName(table, create), this.customStubPath);
    const content = Stub.render(template, table === undefined ? {} : { table });

    fs.writeFileSync(filePath, content);

    return filePath;
  }

  /**
   * The stub the request maps to: create-table for a fresh table,
   * update-table for an existing one, blank otherwise.
   */
  protected stubName(table?: string, create: boolean = false): string {
    if (table && create) {
      return 'create-table';
    }

    if (table) {
      return 'update-table';
    }

    return 'migration';
  }

  /**
   * Get the date prefix for the migration
   */
  protected getDatePrefix(): string {
    const now = new Date();

    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hour = String(now.getHours()).padStart(2, '0');
    const minute = String(now.getMinutes()).padStart(2, '0');
    const second = String(now.getSeconds()).padStart(2, '0');

    return `${year}_${month}_${day}_${hour}${minute}${second}`;
  }

  /**
   * Ensure the migration directory exists
   */
  protected ensureMigrationDirectoryExists(path: string): void {
    if (!fs.existsSync(path)) {
      fs.mkdirSync(path, { recursive: true });
    }
  }
}
