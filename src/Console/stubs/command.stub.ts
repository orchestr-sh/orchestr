/**
 * Console command stub - a subclass of the framework's Command base,
 * discovered by the kernel from app/Console/Commands.
 *
 * Laravel: Illuminate\Foundation\Console\CommandMakeCommand.
 */
export default `/**
 * {{ class }}
 *
 * Namespace: {{ namespace }}
 */

import { Command } from '@orchestr-sh/orchestr';
import type { CommandOptions } from '@orchestr-sh/orchestr';

export class {{ class }} extends Command {
  /**
   * The command name and signature: {name} arguments, {--opt} options.
   */
  signature = '{{ command_name }}';

  /**
   * The command description, shown by \`list\` and \`help\`.
   */
  description = '';

  /**
   * Execute the console command.
   */
  async handle(args: string[], options: CommandOptions): Promise<void> {
    //
  }
}
`;
