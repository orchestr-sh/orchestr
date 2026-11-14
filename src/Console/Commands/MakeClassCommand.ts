/**
 * MakeClassCommand
 *
 * The "nothing else fits" generator: a plain class at the root of the
 * app/ tree (or anywhere its name's subdirectories point).
 * Mirrors Laravel's generic class.stub.
 */

import { CommandOptions } from '@/Console/Command';
import { GeneratorCommand, GeneratorContext } from '../Generators/GeneratorCommand';

export class MakeClassCommand extends GeneratorCommand {
  signature = 'make:class {name} {--force}';
  description = 'Create a new class';

  protected artifact = 'Class';

  protected stubName(context: GeneratorContext, options: CommandOptions): string {
    return 'class';
  }

  protected targetDirectory(options: CommandOptions): string {
    return this.app.path();
  }
}
