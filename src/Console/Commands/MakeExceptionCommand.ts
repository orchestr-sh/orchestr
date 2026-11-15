/**
 * MakeExceptionCommand
 *
 * Create a new exception class.
 * Mirrors Laravel's `php artisan make:exception`.
 */

import { CommandOptions } from '@/Console/Command';
import { Str } from '@/Support/Str';
import { GeneratorCommand, GeneratorContext } from '../Generators/GeneratorCommand';
import { StubReplacements } from '../Generators/Stub';

export class MakeExceptionCommand extends GeneratorCommand {
  signature = 'make:exception {name} {--force}';
  description = 'Create a new exception class';

  protected artifact = 'Exception';

  protected stubName(context: GeneratorContext, options: CommandOptions): string {
    return 'exception';
  }

  protected targetDirectory(options: CommandOptions): string {
    return this.app.path('Exceptions');
  }

  protected replacements(context: GeneratorContext, options: CommandOptions): StubReplacements {
    const stripped = context.className.replace(/Exception$/u, '');

    return {
      message: Str.title(Str.snake(stripped === '' ? context.className : stripped).replace(/_/gu, ' ')),
    };
  }
}
