/**
 * MakeRequestCommand
 *
 * Create a new form request class.
 * Mirrors Laravel's `php artisan make:request`.
 */

import { CommandOptions } from '@/Console/Command';
import { GeneratorCommand, GeneratorContext } from '../Generators/GeneratorCommand';

export class MakeRequestCommand extends GeneratorCommand {
  signature = 'make:request {name} {--force}';
  description = 'Create a new form request class';

  protected artifact = 'Request';

  protected stubName(context: GeneratorContext, options: CommandOptions): string {
    return 'request';
  }

  protected targetDirectory(options: CommandOptions): string {
    return this.app.path('Http/Requests');
  }
}
