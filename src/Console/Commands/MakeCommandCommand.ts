/**
 * MakeCommandCommand
 *
 * Create a new console command class. Generated commands land in
 * app/Console/Commands, where the kernel's command discovery picks them
 * up automatically.
 * Mirrors Laravel's `php artisan make:command`.
 */

import { CommandOptions } from '@/Console/Command';
import { Str } from '@/Support/Str';
import { GeneratorCommand, GeneratorContext } from '../Generators/GeneratorCommand';
import { StubReplacements } from '../Generators/Stub';

export class MakeCommandCommand extends GeneratorCommand {
  signature = 'make:command {name} {--command=} {--force}';
  description = 'Create a new console command class';

  protected artifact = 'Command';

  protected stubName(context: GeneratorContext, options: CommandOptions): string {
    return 'command';
  }

  protected targetDirectory(options: CommandOptions): string {
    return this.app.path('Console/Commands');
  }

  protected replacements(context: GeneratorContext, options: CommandOptions): StubReplacements {
    return { command_name: this.valueOption(options, 'command') ?? this.deriveSignature(context.className) };
  }

  /**
   * The signature a command name implies: `SendPodcastLogs` becomes
   * `send:podcast-logs`, the way Artisan names its own commands.
   */
  private deriveSignature(className: string): string {
    const stripped = className.replace(/Command$/u, '');
    const kebab = Str.kebab(stripped === '' ? className : stripped);
    const colon = kebab.indexOf('-');

    return colon === -1 ? kebab : `${kebab.slice(0, colon)}:${kebab.slice(colon + 1)}`;
  }
}
