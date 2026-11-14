/**
 * MakeMailCommand
 *
 * Create a new mail class - a renderable message built on the
 * framework's view layer.
 * Mirrors Laravel's `php artisan make:mail`.
 */

import { CommandOptions } from '@/Console/Command';
import { Str } from '@/Support/Str';
import { GeneratorCommand, GeneratorContext } from '../Generators/GeneratorCommand';
import { StubReplacements } from '../Generators/Stub';

export class MakeMailCommand extends GeneratorCommand {
  signature = 'make:mail {name} {--force}';
  description = 'Create a new mail class';

  protected artifact = 'Mail';

  protected stubName(context: GeneratorContext, options: CommandOptions): string {
    return 'mail';
  }

  protected targetDirectory(options: CommandOptions): string {
    return this.app.path('Mail');
  }

  protected replacements(context: GeneratorContext, options: CommandOptions): StubReplacements {
    return {
      subject: this.humanName(context.className),
      view_name: `mail.${Str.kebab(context.className)}`,
    };
  }

  /**
   * "OrderShipped" becomes the human subject "Order Shipped".
   */
  private humanName(className: string): string {
    return Str.title(Str.snake(className).replace(/_/gu, ' '));
  }
}
