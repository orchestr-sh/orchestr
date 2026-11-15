/**
 * MakePolicyCommand
 *
 * Create a new policy class extending the framework's Policy base, with
 * the standard resource abilities. `--model` binds the model-specific
 * verbs to the model class.
 * Mirrors Laravel's `php artisan make:policy`.
 */

import { CommandOptions } from '@/Console/Command';
import { Str } from '@/Support/Str';
import { GeneratorCommand, GeneratorContext } from '../Generators/GeneratorCommand';
import { StubReplacements } from '../Generators/Stub';

export class MakePolicyCommand extends GeneratorCommand {
  signature = 'make:policy {name} {--model=} {--force}';
  description = 'Create a new policy class';

  protected artifact = 'Policy';

  protected stubName(context: GeneratorContext, options: CommandOptions): string {
    return 'policy';
  }

  protected targetDirectory(options: CommandOptions): string {
    return this.app.path('Policies');
  }

  protected replacements(context: GeneratorContext, options: CommandOptions): StubReplacements {
    const model = this.valueOption(options, 'model');

    if (model === undefined) {
      return { model_import: '', model_arg: '' };
    }

    return {
      model,
      // Laravel types the verbs against a model instance: update($user, $post).
      model_arg: `, ${Str.camel(model)}: ${model}`,
      model_import: this.modelImport(context, model),
    };
  }

  /**
   * The import statement for the bound model, resolved through the
   * configured path mapping.
   */
  private modelImport(context: GeneratorContext, model: string): string {
    return `import { ${model} } from '${this.relativeImport(context.directory, this.app.path(`Models/${model}.ts`))}';`;
  }
}
