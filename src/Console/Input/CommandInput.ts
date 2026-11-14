/**
 * CommandInput
 *
 * Binds raw CLI tokens (positional arguments and parsed `--option` values) to
 * a parsed command signature: resolving arguments by position, collecting
 * array arguments, applying declared defaults, normalising option shortcuts to
 * their canonical long names, and validating missing/unknown arguments.
 *
 * The class deliberately keeps the legacy contract of the console kernel:
 * options that a signature does not declare are passed through untouched so
 * commands (and scheduled task strings) that read `--whatever` continue to
 * work exactly as before.
 */

import type { CommandOptions } from '../Command';
import type { ParsedSignature, SignatureArgument, SignatureOption } from './CommandSignature';

/**
 * Raised when the provided input does not satisfy a command's signature.
 * Carries the usage line so the kernel can print it alongside the message.
 */
export class ConsoleInputError extends Error {
  public readonly usage: string;

  constructor(message: string, usage: string = '') {
    super(message);
    this.name = 'ConsoleInputError';
    this.usage = usage;
  }
}

export class CommandInput {
  private argumentValues: Map<string, string | string[] | null> = new Map();
  private positional: string[] = [];
  private extraPositional: string[] = [];
  private mergedOptions: CommandOptions = {};

  constructor(
    private definition: ParsedSignature,
    positional: string[],
    rawOptions: CommandOptions
  ) {
    this.bindArguments(positional);
    this.bindOptions(rawOptions);
  }

  /**
   * The parsed signature this input was bound against.
   */
  getDefinition(): ParsedSignature {
    return this.definition;
  }

  /**
   * Positional argument values in signature order (defaults included when
   * non-null). This is what the kernel hands to `handle()` as `args`.
   */
  getArgumentsPositional(): string[] {
    return [...this.positional];
  }

  /**
   * All resolved argument values keyed by name.
   */
  getArguments(): Record<string, string | string[] | null> {
    const result: Record<string, string | string[] | null> = {};

    for (const argument of this.definition.arguments) {
      result[argument.name] = this.argumentValues.get(argument.name) ?? null;
    }

    return result;
  }

  /**
   * Resolve one argument by name.
   */
  getArgument(name: string): string | string[] | null {
    const argument = this.findArgument(name);

    if (!argument) {
      throw new ConsoleInputError(
        `The "${name}" argument does not exist on command "${this.definition.name}".`,
        this.definition.usage
      );
    }

    return this.argumentValues.get(argument.name) ?? null;
  }

  hasArgument(name: string): boolean {
    return this.findArgument(name) !== undefined;
  }

  /**
   * The merged option record: declared defaults, canonicalised provided
   * values, and unknown options passed through untouched. This is what the
   * kernel hands to `handle()` as `options`.
   */
  getOptions(): CommandOptions {
    return this.mergedOptions;
  }

  /**
   * Resolve one option by canonical name or shortcut. Unknown names fall
   * back to the raw record so legacy commands keep working.
   */
  getOption(name: string): unknown {
    const option = this.findOption(name);

    if (option) {
      return this.mergedOptions[option.name];
    }

    return this.mergedOptions[name];
  }

  hasOption(name: string): boolean {
    return this.findOption(name) !== undefined;
  }

  /**
   * Overwrite an option value after binding (used by commands that derive
   * defaults programmatically, mirroring Laravel's `setOption`).
   */
  setOption(name: string, value: unknown): void {
    const option = this.findOption(name);
    this.mergedOptions[option ? option.name : name] = value;
  }

  /**
   * Validate the bound input against the signature.
   *
   * @throws ConsoleInputError when a required argument is missing or unknown
   * positional arguments were given. The error carries the usage string so
   * callers can print usage alongside the message.
   */
  validate(): void {
    const missing = this.definition.arguments
      .filter((argument) => argument.required && this.argumentValues.get(argument.name) === null)
      .map((argument) => argument.name);

    if (missing.length > 0) {
      const listed = missing.map((name) => `"${name}"`).join(', ');

      throw new ConsoleInputError(
        `Not enough arguments to "${this.definition.name}" command (missing: ${listed}).`,
        this.definition.usage
      );
    }

    if (this.extraPositional.length > 0) {
      const expected = this.definition.arguments.map((argument) => `"${argument.name}"`).join(', ');
      const suffix =
        expected === '' ? ' and this command does not accept arguments' : `, expected arguments ${expected}`;

      throw new ConsoleInputError(
        `Too many arguments to "${this.definition.name}" command${suffix}.`,
        this.definition.usage
      );
    }
  }

  /**
   * Consume positional tokens against the signature's argument list. Array
   * arguments swallow everything that remains at their position.
   */
  private bindArguments(positional: string[]): void {
    const remaining = [...positional];

    for (const argument of this.definition.arguments) {
      if (argument.isArray) {
        const taken = remaining.splice(0, remaining.length);
        const value = taken.length > 0 ? taken : Array.isArray(argument.default) ? argument.default : [];

        this.argumentValues.set(argument.name, value);
        this.positional.push(...taken);
        continue;
      }

      if (remaining.length > 0) {
        const value = remaining.shift() as string;
        this.argumentValues.set(argument.name, value);
        this.positional.push(value);
      } else {
        this.argumentValues.set(argument.name, argument.default);

        if (argument.default !== null) {
          this.positional.push(argument.default as string);
        }
      }
    }

    this.extraPositional = remaining;
  }

  /**
   * Merge declared option defaults with the raw values parsed from argv.
   * Shortcuts are normalised to their canonical long name; values that the
   * signature does not declare pass through unchanged.
   */
  private bindOptions(rawOptions: CommandOptions): void {
    const merged: CommandOptions = {};

    for (const option of this.definition.options) {
      merged[option.name] = cloneDefault(option);
    }

    const byKey = new Map<string, string>();

    for (const option of this.definition.options) {
      byKey.set(option.name, option.name);

      if (option.shortcut !== undefined) {
        byKey.set(option.shortcut, option.name);
      }
    }

    for (const [key, value] of Object.entries(rawOptions)) {
      const canonical = byKey.get(key);

      if (canonical === undefined) {
        merged[key] = value;
        continue;
      }

      const option = this.definition.options.find((candidate) => candidate.name === canonical) as SignatureOption;

      if (option.isArray) {
        merged[canonical] = value === true ? cloneDefault(option) : Array.isArray(value) ? value : [value];
        continue;
      }

      if (option.requiresValue && value === true) {
        // A bare `--opt` on a value option falls back to its declared default,
        // mirroring Symfony's behaviour for `--opt` without a value.
        merged[canonical] = cloneDefault(option);
        continue;
      }

      merged[canonical] = value;
    }

    this.mergedOptions = merged;
  }

  private findArgument(name: string): SignatureArgument | undefined {
    return this.definition.arguments.find((argument) => argument.name === name);
  }

  private findOption(name: string): SignatureOption | undefined {
    return this.definition.options.find((option) => option.name === name || option.shortcut === name);
  }
}

function cloneDefault(option: SignatureOption): string | string[] | boolean | null {
  return Array.isArray(option.default) ? [...option.default] : option.default;
}
