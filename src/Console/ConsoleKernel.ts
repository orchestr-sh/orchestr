/**
 * ConsoleKernel
 *
 * The console kernel handles registration and execution of console commands
 */

import { Command, CommandOptions } from './Command';
import { Application } from '@/Foundation/Application';

export class ConsoleKernel {
  protected commands: Map<string, Command> = new Map();

  constructor(protected app: Application) {
    this.registerCommands();
  }

  /**
   * Register console commands
   */
  protected registerCommands(): void {
    // Override this method in your application's kernel to register commands
  }

  /**
   * Register a command
   */
  register(command: Command): void {
    this.commands.set(command.getName(), command);
  }

  /**
   * Register multiple commands
   */
  registerMany(commands: Command[]): void {
    commands.forEach((command) => this.register(command));
  }

  /**
   * Run a console command
   */
  async handle(commandName: string, args: string[] = [], options: CommandOptions = {}): Promise<void> {
    const command = this.commands.get(commandName);

    if (!command) {
      throw new Error(`Command not found: ${commandName}`);
    }

    await command.handle(args, options);
  }

  /**
   * Run the console kernel from CLI arguments
   */
  async run(argv: string[] = process.argv): Promise<void> {
    // Parse arguments: node script.js command-name arg1 arg2 --option=value
    const args = argv.slice(2);

    if (args.length === 0) {
      this.listCommands();
      return;
    }

    const commandName = args[0];
    const commandArgs: string[] = [];
    const options: CommandOptions = {};

    // Parse arguments and options
    for (let i = 1; i < args.length; i++) {
      const arg = args[i];

      if (arg.startsWith('--')) {
        // Parse option: --option=value or --option
        const parts = arg.slice(2).split('=');
        const optionName = parts[0];
        const optionValue = parts.length > 1 ? parts[1] : true;
        options[optionName] = optionValue;
      } else if (arg.startsWith('-')) {
        // Parse short option: -o
        const optionName = arg.slice(1);
        options[optionName] = true;
      } else {
        // Regular argument
        commandArgs.push(arg);
      }
    }

    try {
      await this.handle(commandName, commandArgs, options);
    } catch (error) {
      console.error(`\x1b[31mError: ${(error as Error).message}\x1b[0m`);
      process.exit(1);
    }
  }

  /**
   * List all registered commands
   */
  protected listCommands(): void {
    console.log('\x1b[33mAvailable commands:\x1b[0m\n');

    this.commands.forEach((command) => {
      console.log(`  \x1b[32m${command.signature}\x1b[0m`);
      console.log(`    ${command.description}\n`);
    });
  }

  /**
   * Get all registered commands
   */
  getCommands(): Map<string, Command> {
    return this.commands;
  }

  /**
   * Get the application instance
   */
  getApplication(): Application {
    return this.app;
  }
}
