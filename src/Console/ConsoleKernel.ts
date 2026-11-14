/**
 * ConsoleKernel
 *
 * The console kernel handles registration, discovery, and execution of
 * console commands, mirroring Laravel's Artisan application layer:
 *
 * - Commands come from explicit registration, a manifest
 *   (`src/Console/Commands/index.ts`), or discovery of configured
 *   directories (`app/Console/Commands`) resolved through the container.
 * - `run()` parses argv into a command name, positional arguments, and
 *   options, then validates them against the command's parsed signature
 *   via `CommandInput`, printing usage on mistakes.
 * - Global flags: `--help`/`-h`, `help <command>`, `list`, `--quiet`/`-q`,
 *   `--no-interaction`/`-n`, and the verbosity ladder `-v`/`-vv`/`-vvv`
 *   (`--verbose`).
 * - All output is written through a single `OutputStyle` instance per run,
 *   shared by the kernel and every command (DRY).
 */

import { Application } from '@/Foundation/Application';
import type { ParsedSignature, SignatureArgument, SignatureOption } from './Input/CommandSignature';
import { Command, CommandOptions } from './Command';
import { CommandDiscovery, ModuleImporter } from './Discovery/CommandDiscovery';
import { CommandInput, ConsoleInputError } from './Input/CommandInput';
import { OutputStyle } from './Output/OutputStyle';

/** Built-in kernel commands shown in `list` and dispatched in `run()`. */
const BUILT_IN_COMMANDS: Array<[string, string]> = [
  ['help', 'Displays help for a command'],
  ['list', 'Lists all commands'],
];

/** Global options accepted for every command. */
const GLOBAL_OPTIONS: Array<[string, string]> = [
  ['-h, --help', 'Displays help for a command'],
  ['-q, --quiet', 'Only errors are output to the console'],
  ['-v, -vv, -vvv, --verbose', 'Increase the verbosity of messages'],
  ['-n, --no-interaction', 'Do not ask any interactive question'],
];

interface KernelArgv {
  command?: string;
  args: string[];
  options: CommandOptions;
  help: boolean;
  quiet: boolean;
  verbosity: number;
  interactive: boolean;
}

export class ConsoleKernel {
  protected commands: Map<string, Command> = new Map();

  /** The style for the active dispatch (run() or handle()). */
  private currentStyle: OutputStyle | null = null;

  constructor(protected app: Application) {
    // Expose the kernel in the container so subsystems (task scheduling,
    // programmatic command calls) can dispatch through it, mirroring
    // Laravel's binding of the console kernel contract.
    this.app.instance('console', this);

    // Creating the kernel *is* console execution; declare it instead of
    // relying on argv heuristics so runningInConsole() is exact.
    this.app.setRunningInConsole(true);

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
   * Discover commands in the given directories (default:
   * `app/Console/Commands`), resolve them through the container, and
   * register them. Later registrations win on name collisions, so
   * application commands can override framework ones.
   */
  async discoverCommands(paths?: string[], importer?: ModuleImporter): Promise<Command[]> {
    const discovery = new CommandDiscovery(this.app, importer);
    const discovered = await discovery.discover(paths);

    this.registerMany(discovered);

    return discovered;
  }

  /**
   * Run a console command
   *
   * Arguments and options are validated against the command's signature
   * before `handle()` executes; resolved positional arguments and the
   * merged option record are what the command receives.
   */
  async handle(commandName: string, args: string[] = [], options: CommandOptions = {}): Promise<void> {
    const command = this.commands.get(commandName);

    if (!command) {
      throw new Error(`Command not found: ${commandName}`);
    }

    const input = new CommandInput(command.getDefinition(), args, options);
    input.validate();

    command.setStyle(this.getStyle());
    command.setInput(input);

    await command.handle(input.getArgumentsPositional(), input.getOptions());
  }

  /**
   * Run the console kernel from CLI arguments
   */
  async run(argv: string[] = process.argv): Promise<void> {
    const parsed = this.parseArgv(argv);

    this.currentStyle = new OutputStyle({
      quiet: parsed.quiet,
      verbosity: parsed.verbosity,
      interactive: parsed.interactive,
    });

    try {
      if (parsed.command === undefined) {
        // No command given: `orchestr --help` shows the overview, plain
        // `orchestr` lists commands, exactly like Artisan.
        if (parsed.help) {
          this.showHelp(undefined);
        } else {
          this.listCommands();
        }

        return;
      }

      if (parsed.help) {
        this.showHelp(parsed.command);
        return;
      }

      switch (parsed.command) {
        case 'list':
          this.listCommands();
          return;
        case 'help':
          this.showHelp(parsed.args[0]);
          return;
      }

      await this.handle(parsed.command, parsed.args, parsed.options);
    } catch (error) {
      this.reportError(error as Error);
      process.exit(1);
    } finally {
      this.currentStyle = null;
    }
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

  /**
   * The style every command should write through for the active dispatch.
   */
  protected getStyle(): OutputStyle {
    if (this.currentStyle === null) {
      this.currentStyle = new OutputStyle();
    }

    return this.currentStyle;
  }

  /**
   * Split argv into the command name, positional arguments, raw options,
   * and the global flags the kernel interprets.
   */
  protected parseArgv(argv: string[]): KernelArgv {
    const tokens = argv.slice(2);
    const options: CommandOptions = {};
    const positional: string[] = [];

    let help = false;
    let quiet = false;
    let verbosity = 1;
    let noInteraction = false;
    let afterSeparator = false;

    for (const token of tokens) {
      if (afterSeparator) {
        positional.push(token);
        continue;
      }

      if (token === '--') {
        afterSeparator = true;
        continue;
      }

      if (token.startsWith('--')) {
        const equals = token.indexOf('=');
        const name = equals === -1 ? token.slice(2) : token.slice(2, equals);
        const value: unknown = equals === -1 ? true : token.slice(equals + 1);

        options[name] = value;

        if (name === 'help') {
          help = true;
        } else if (name === 'quiet') {
          quiet = true;
        } else if (name === 'verbose') {
          verbosity = Math.max(verbosity, typeof value === 'string' ? Number.parseInt(value, 10) || 1 : 1);
        } else if (name === 'no-interaction') {
          noInteraction = true;
        }

        continue;
      }

      if (token.startsWith('-') && token.length > 1) {
        const name = token.slice(1);

        options[name] = true;

        if (/^v{1,3}$/.test(name)) {
          verbosity = Math.max(verbosity, name.length);
        } else if (name === 'q') {
          quiet = true;
        } else if (name === 'h') {
          help = true;
        } else if (name === 'n') {
          noInteraction = true;
        }

        continue;
      }

      positional.push(token);
    }

    const [command, ...args] = positional;

    return {
      command,
      args,
      options,
      help,
      quiet,
      verbosity,
      interactive: !noInteraction && process.stdin.isTTY === true,
    };
  }

  /**
   * List all registered commands, plus the built-in help/list entries.
   */
  protected listCommands(): void {
    const style = this.getStyle();

    style.comment(`Orchestr ${this.app.version()}`);
    style.newLine();
    style.info('Available commands:');

    const rows: Array<[string, string]> = [
      ...BUILT_IN_COMMANDS,
      ...[...this.commands.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, command]) => [name, command.description] as [string, string]),
    ];

    const width = Math.max(...rows.map(([name]) => name.length)) + 2;

    for (const [name, description] of rows) {
      style.line(`  ${name.padEnd(width)}${description}`);
    }
  }

  /**
   * Print help for one command, or the general overview when no target is
   * given (Laravel's `help <command>` / `--help`).
   */
  protected showHelp(commandName?: string): void {
    const style = this.getStyle();

    if (commandName === undefined) {
      style.line('Usage: orchestr <command> [arguments] [options]');
      style.newLine();
      this.printRows(GLOBAL_OPTIONS);
      style.newLine();
      this.listCommands();

      return;
    }

    const command = this.commands.get(commandName);

    if (!command) {
      throw new Error(`Command not found: ${commandName}`);
    }

    const definition = command.getDefinition();

    style.info(command.description);
    style.newLine();
    style.line(`Usage: ${definition.usage}`);

    if (definition.arguments.length > 0) {
      style.newLine();
      style.comment('Arguments:');
      this.printRows(definition.arguments.map(renderArgumentRow));
    }

    style.newLine();
    style.comment('Options:');
    this.printRows([...definition.options.map(renderOptionRow), ...GLOBAL_OPTIONS]);
  }

  private printRows(rows: Array<[string, string]>): void {
    const style = this.getStyle();
    const width = Math.max(...rows.map(([left]) => left.length)) + 2;

    for (const [left, right] of rows) {
      style.line(`  ${left.padEnd(width)}${right}`.trimEnd());
    }
  }

  /**
   * Report a dispatch failure through the style, adding the usage line
   * for signature validation errors and the stack at `-vv`.
   */
  protected reportError(error: Error): void {
    const style = this.getStyle();

    style.error(`Error: ${error.message}`);

    if (error instanceof ConsoleInputError && error.usage !== '') {
      style.comment(`Usage: ${error.usage}`);
    }

    if (style.getVerbosity() >= 2 && error.stack !== undefined) {
      style.comment(error.stack);
    }
  }
}

function renderArgumentRow(argument: SignatureArgument): [string, string] {
  const details: string[] = [];

  if (argument.description !== '') {
    details.push(argument.description);
  }

  if (!argument.required && argument.default !== null && argument.default !== undefined) {
    details.push(`[default: ${formatValue(argument.default)}]`);
  }

  return [argument.name + (argument.required ? '' : '?'), details.join(' ')];
}

function renderOptionRow(option: SignatureOption): [string, string] {
  const name = option.shortcut !== undefined ? `-${option.shortcut}, --${option.name}` : `    --${option.name}`;

  const details: string[] = [];

  if (option.description !== '') {
    details.push(option.description);
  }

  if (option.requiresValue && option.default !== null && option.default !== false) {
    details.push(`[default: ${formatValue(option.default)}]`);
  }

  return [name, details.join(' ')];
}

function formatValue(value: unknown): string {
  return Array.isArray(value) ? `[${value.join(', ')}]` : String(value);
}
