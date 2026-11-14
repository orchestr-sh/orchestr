/**
 * MakeObserverCommand
 *
 * Create a new model observer. `--model` types the hooks against the
 * observed model; without one they fall back to the framework's Ensemble
 * base so the generated file always compiles.
 * Mirrors Laravel's `php artisan make:observer`.
 */

import { CommandOptions } from '@/Console/Command';
import { GeneratorCommand, GeneratorContext } from '../Generators/GeneratorCommand';
import { StubReplacements } from '../Generators/Stub';

export class MakeObserverCommand extends GeneratorCommand {
  signature = 'make:observer {name} {--model=} {--force}';
  description = 'Create a new observer class';

  protected artifact = 'Observer';

  protected stubName(context: GeneratorContext, options: CommandOptions): string {
    return 'observer';
  }

  protected targetDirectory(options: CommandOptions): string {
    return this.app.path('Observers');
  }

  protected replacements(context: GeneratorContext, options: CommandOptions): StubReplacements {
    const model = this.valueOption(options, 'model');

    if (model === undefined) {
      return { model: 'Ensemble', model_import: "import { Ensemble } from '@orchestr-sh/orchestr';" };
    }

    const importPath = this.relativeImport(context.directory, this.app.path(`Models/${model}.ts`));

    return { model, model_import: `import { ${model} } from '${importPath}';` };
  }
}
