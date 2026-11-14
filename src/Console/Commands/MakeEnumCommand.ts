/**
 * MakeEnumCommand
 *
 * Create a new enum.
 * Mirrors Laravel's `php artisan make:enum`.
 */

import { CommandOptions } from '@/Console/Command';
import { GeneratorCommand, GeneratorContext } from '../Generators/GeneratorCommand';

export class MakeEnumCommand extends GeneratorCommand {
  signature = 'make:enum {name} {--force}';
  description = 'Create a new enum class';

  protected artifact = 'Enum';

  protected stubName(context: GeneratorContext, options: CommandOptions): string {
    return 'enum';
  }

  protected targetDirectory(options: CommandOptions): string {
    return this.app.path('Enums');
  }
}
