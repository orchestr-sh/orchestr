/**
 * MakeModelCommand
 *
 * Create a new Ensemble model class, optionally with the matching
 * migration, factory, and seeder - Laravel spawns the sibling generator
 * commands for those (`Illuminate\Foundation\Console\ModelMakeCommand`),
 * so this command does the same and every artefact keeps flowing through
 * the one stub pipeline.
 */

import { CommandOptions } from '@/Console/Command';
import { GeneratorCommand, GeneratorContext } from '../Generators/GeneratorCommand';
import { StubReplacements } from '../Generators/Stub';
import { MakeFactoryCommand } from './MakeFactoryCommand';
import { MakeMigrationCommand } from './MakeMigrationCommand';
import { MakeSeederCommand } from './MakeSeederCommand';

export class MakeModelCommand extends GeneratorCommand {
  signature = 'make:model {name} {--m|migration} {--f|factory} {--s|seed} {--p|pivot} {--table=} {--all} {--force}';
  description = 'Create a new model class';

  protected artifact = 'Model';

  protected stubName(context: GeneratorContext, options: CommandOptions): string {
    return this.flag(options, 'pivot', 'p') ? 'model-pivot' : 'model';
  }

  protected targetDirectory(options: CommandOptions): string {
    return this.app.path('Models');
  }

  protected validateInput(context: GeneratorContext, options: CommandOptions): string | null {
    // Laravel's ModelMakeCommand refuses to build a pivot model it has no
    // join table for.
    if (this.flag(options, 'pivot', 'p') && this.valueOption(options, 'table') === undefined) {
      return 'The [pivot] option requires [table].';
    }

    return null;
  }

  protected replacements(context: GeneratorContext, options: CommandOptions): StubReplacements {
    return { table: this.tableFor(context.className, options) };
  }

  protected async created(context: GeneratorContext, options: CommandOptions): Promise<void> {
    const all = this.flag(options, 'all');

    if (all || this.flag(options, 'migration', 'm')) {
      const table = this.tableFor(context.className, options);

      await new MakeMigrationCommand(this.app)
        .setStyle(this.getStyle())
        .handle([`create_${table}_table`], { table, create: true });
    }

    if (all || this.flag(options, 'factory', 'f')) {
      await new MakeFactoryCommand(this.app)
        .setStyle(this.getStyle())
        .handle([`${context.className}Factory`], this.forwarded(options, { model: context.className }));
    }

    if (all || this.flag(options, 'seed', 's')) {
      await new MakeSeederCommand(this.app)
        .setStyle(this.getStyle())
        .handle([`${context.className}Seeder`], this.forwarded(options, {}));
    }
  }

  /**
   * The table a model maps to: `--table` wins, else the snake-cased plural.
   */
  private tableFor(className: string, options: CommandOptions): string {
    return this.valueOption(options, 'table') ?? this.tableName(className);
  }

  /**
   * Options the companion commands inherit from the model run.
   */
  private forwarded(options: CommandOptions, extra: CommandOptions): CommandOptions {
    return this.flag(options, 'force') ? { ...extra, force: true } : extra;
  }
}
