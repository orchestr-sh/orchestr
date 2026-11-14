/**
 * MakeRuleCommand
 *
 * Create a new invokable validation rule matching the framework's
 * ValidationRuleObject contract.
 * Mirrors Laravel's `php artisan make:rule`.
 */

import { CommandOptions } from '@/Console/Command';
import { Str } from '@/Support/Str';
import { GeneratorCommand, GeneratorContext } from '../Generators/GeneratorCommand';
import { StubReplacements } from '../Generators/Stub';

export class MakeRuleCommand extends GeneratorCommand {
  signature = 'make:rule {name} {--force}';
  description = 'Create a new validation rule class';

  protected artifact = 'Rule';

  protected stubName(context: GeneratorContext, options: CommandOptions): string {
    return 'rule';
  }

  protected targetDirectory(options: CommandOptions): string {
    return this.app.path('Rules');
  }

  protected replacements(context: GeneratorContext, options: CommandOptions): StubReplacements {
    return { rule_name: Str.snake(context.className) };
  }
}
