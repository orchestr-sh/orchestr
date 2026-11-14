/**
 * MakeFactoryCommand
 *
 * Create a new model factory. The model is taken from `--model` or from
 * the `XFactory` naming convention; when neither resolves, the pending
 * stub leaves the pairing as a commented `registerFactory()` call.
 * Mirrors Laravel's `php artisan make:factory`.
 */

import { CommandOptions } from '@/Console/Command';
import { GeneratorCommand, GeneratorContext } from '../Generators/GeneratorCommand';
import { StubReplacements } from '../Generators/Stub';

export class MakeFactoryCommand extends GeneratorCommand {
  signature = 'make:factory {name} {--model=} {--force}';
  description = 'Create a new factory class';

  protected artifact = 'Factory';

  protected stubName(context: GeneratorContext, options: CommandOptions): string {
    return this.resolveModel(context, options) === null ? 'factory-pending' : 'factory';
  }

  protected targetDirectory(options: CommandOptions): string {
    return this.app.databasePath('factories');
  }

  protected replacements(context: GeneratorContext, options: CommandOptions): StubReplacements {
    const model = this.resolveModel(context, options);

    if (model === null) {
      return {};
    }

    const importPath = this.relativeImport(context.directory, this.app.path(`Models/${model}.ts`));

    return { model, model_import: `import { ${model} } from '${importPath}';` };
  }

  /**
   * `--model` wins; else the class-name convention pairs `PostFactory`
   * with `Post` the way Laravel's factories do.
   */
  private resolveModel(context: GeneratorContext, options: CommandOptions): string | null {
    const explicit = this.valueOption(options, 'model');

    if (explicit !== undefined) {
      return explicit;
    }

    return context.className.endsWith('Factory') ? context.className.slice(0, -'Factory'.length) : null;
  }
}
