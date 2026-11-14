/**
 * MakeTraitCommand
 *
 * Create a new trait. TypeScript has no traits, so the generated file
 * follows the mixin pattern the framework itself uses for concerns: a
 * function wrapping a base class and returning the extended abstraction.
 * Mirrors Laravel's `php artisan make:trait`.
 */

import { CommandOptions } from '@/Console/Command';
import { GeneratorCommand, GeneratorContext } from '../Generators/GeneratorCommand';

export class MakeTraitCommand extends GeneratorCommand {
  signature = 'make:trait {name} {--force}';
  description = 'Create a new trait (mixin) class';

  protected artifact = 'Trait';

  protected stubName(context: GeneratorContext, options: CommandOptions): string {
    return 'trait';
  }

  protected targetDirectory(options: CommandOptions): string {
    return this.app.path('Traits');
  }
}
