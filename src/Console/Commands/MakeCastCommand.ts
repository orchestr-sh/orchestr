/**
 * MakeCastCommand
 *
 * Create a new custom cast class.
 * Mirrors Laravel's `php artisan make:cast`.
 */

import { CommandOptions } from '@/Console/Command';
import { GeneratorCommand, GeneratorContext } from '../Generators/GeneratorCommand';

export class MakeCastCommand extends GeneratorCommand {
  signature = 'make:cast {name} {--force}';
  description = 'Create a new custom cast class';

  protected artifact = 'Cast';

  protected stubName(context: GeneratorContext, options: CommandOptions): string {
    return 'cast';
  }

  protected targetDirectory(options: CommandOptions): string {
    return this.app.path('Casts');
  }
}
