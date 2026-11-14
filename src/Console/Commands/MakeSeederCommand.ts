/**
 * MakeSeederCommand
 *
 * Create a new seeder class in the application's configured
 * database/seeders directory.
 */

import { CommandOptions } from '@/Console/Command';
import { GeneratorCommand, GeneratorContext } from '../Generators/GeneratorCommand';

export class MakeSeederCommand extends GeneratorCommand {
  signature = 'make:seeder {name} {--force}';
  description = 'Create a new seeder class';

  protected artifact = 'Seeder';

  protected stubName(context: GeneratorContext, options: CommandOptions): string {
    return 'seeder';
  }

  protected targetDirectory(options: CommandOptions): string {
    return this.app.databasePath('seeders');
  }
}
