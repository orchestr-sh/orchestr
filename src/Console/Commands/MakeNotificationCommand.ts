/**
 * MakeNotificationCommand
 *
 * Create a new notification class with the channels/toMail/toArray
 * surface Laravel notifications expose.
 * Mirrors Laravel's `php artisan make:notification`.
 */

import { CommandOptions } from '@/Console/Command';
import { Str } from '@/Support/Str';
import { GeneratorCommand, GeneratorContext } from '../Generators/GeneratorCommand';
import { StubReplacements } from '../Generators/Stub';

export class MakeNotificationCommand extends GeneratorCommand {
  signature = 'make:notification {name} {--force}';
  description = 'Create a new notification class';

  protected artifact = 'Notification';

  protected stubName(context: GeneratorContext, options: CommandOptions): string {
    return 'notification';
  }

  protected targetDirectory(options: CommandOptions): string {
    return this.app.path('Notifications');
  }

  protected replacements(context: GeneratorContext, options: CommandOptions): StubReplacements {
    return { subject: Str.title(Str.snake(context.className).replace(/_/gu, ' ')) };
  }
}
