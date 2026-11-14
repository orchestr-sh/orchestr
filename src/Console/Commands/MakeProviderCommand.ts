/**
 * MakeProviderCommand
 *
 * Create a new service provider class.
 * Mirrors Laravel's `php artisan make:provider`.
 */

import { CommandOptions } from '@/Console/Command';
import { GeneratorCommand, GeneratorContext } from '../Generators/GeneratorCommand';

export class MakeProviderCommand extends GeneratorCommand {
  signature = 'make:provider {name} {--force}';
  description = 'Create a new service provider class';

  protected artifact = 'Provider';

  protected stubName(context: GeneratorContext, options: CommandOptions): string {
    return 'provider';
  }

  protected targetDirectory(options: CommandOptions): string {
    return this.app.path('Providers');
  }
}
