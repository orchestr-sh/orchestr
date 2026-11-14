/**
 * MakeTestCommand
 *
 * Create a new vitest test file under tests/Feature, or tests/Unit with
 * `--unit`.
 * Mirrors Laravel's `php artisan make:test`.
 */

import * as path from 'path';
import { CommandOptions } from '@/Console/Command';
import { GeneratorCommand, GeneratorContext } from '../Generators/GeneratorCommand';

export class MakeTestCommand extends GeneratorCommand {
  signature = 'make:test {name} {--unit} {--force}';
  description = 'Create a new test class';

  protected artifact = 'Test';

  protected stubName(context: GeneratorContext, options: CommandOptions): string {
    return 'test';
  }

  protected targetDirectory(options: CommandOptions): string {
    const suite = this.flag(options, 'unit') ? 'Unit' : 'Feature';

    return path.join(this.app.getBasePath(), 'tests', suite);
  }

  protected extension(context: GeneratorContext, options: CommandOptions): string {
    return '.test.ts';
  }
}
