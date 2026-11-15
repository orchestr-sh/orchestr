/**
 * MakeMiddlewareCommand
 *
 * Create a new middleware. The framework's middleware surface is the
 * functional `Middleware` type, so the stub emits an exported const.
 * Mirrors Laravel's `php artisan make:middleware`.
 */

import { CommandOptions } from '@/Console/Command';
import { GeneratorCommand, GeneratorContext } from '../Generators/GeneratorCommand';

export class MakeMiddlewareCommand extends GeneratorCommand {
  signature = 'make:middleware {name} {--force}';
  description = 'Create a new middleware class';

  protected artifact = 'Middleware';

  protected stubName(context: GeneratorContext, options: CommandOptions): string {
    return 'middleware';
  }

  protected targetDirectory(options: CommandOptions): string {
    return this.app.path('Http/Middleware');
  }
}
