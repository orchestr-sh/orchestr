/**
 * MakeInterfaceCommand
 *
 * Create a new interface, living alongside the framework's contracts.
 * Mirrors Laravel's `php artisan make:interface`-style contract files.
 */

import { CommandOptions } from '@/Console/Command';
import { GeneratorCommand, GeneratorContext } from '../Generators/GeneratorCommand';

export class MakeInterfaceCommand extends GeneratorCommand {
  signature = 'make:interface {name} {--force}';
  description = 'Create a new interface';

  protected artifact = 'Interface';

  protected stubName(context: GeneratorContext, options: CommandOptions): string {
    return 'interface';
  }

  protected targetDirectory(options: CommandOptions): string {
    return this.app.path('Contracts');
  }
}
