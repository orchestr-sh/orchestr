/**
 * MakeChannelCommand
 *
 * Create a new broadcast channel class guarding a private channel by
 * name.
 * Mirrors Laravel's `php artisan make:channel`.
 */

import { CommandOptions } from '@/Console/Command';
import { Str } from '@/Support/Str';
import { GeneratorCommand, GeneratorContext } from '../Generators/GeneratorCommand';
import { StubReplacements } from '../Generators/Stub';

export class MakeChannelCommand extends GeneratorCommand {
  signature = 'make:channel {name} {--force}';
  description = 'Create a new channel class';

  protected artifact = 'Channel';

  protected stubName(context: GeneratorContext, options: CommandOptions): string {
    return 'channel';
  }

  protected targetDirectory(options: CommandOptions): string {
    return this.app.path('Broadcasting');
  }

  protected replacements(context: GeneratorContext, options: CommandOptions): StubReplacements {
    const stripped = context.className.replace(/Channel$/u, '');

    return { channel: Str.kebab(stripped === '' ? context.className : stripped) };
  }
}
