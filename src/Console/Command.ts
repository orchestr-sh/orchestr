/**
 * Command
 *
 * Base class for all console commands.
 *
 * Output goes through `OutputStyle` (never `console.*` directly) so every
 * command shares the same colour rules, quiet handling, and prompt
 * fallbacks. The kernel binds the parsed input and a shared style onto the
 * command before `handle()` runs; commands invoked programmatically fall
 * back to sensible defaults.
 */

import type { CommandOptions } from './CommandOptions';
import { CommandInput } from './Input/CommandInput';
import { CommandSignature, ParsedSignature } from './Input/CommandSignature';
import { OutputStyle } from './Output/OutputStyle';

export type { CommandOptions } from './CommandOptions';

export abstract class Command {
  /**
   * The name and signature of the console command, e.g.
   * `make:model {name} {--m|migration} {--all}`.
   */
  abstract signature: string;

  /**
   * The description of the command, shown by `list` and `help`.
   */
  abstract description: string;

  /** Style shared with the kernel; created on demand for direct calls. */
  private outputStyle: OutputStyle | null = null;

  /** Parsed signature, cached per instance. */
  private parsedSignature: ParsedSignature | null = null;

  /** Input bound by the kernel before `handle()` runs. */
  protected input: CommandInput | null = null;

  /**
   * Execute the command with positional arguments and parsed options.
   */
  abstract handle(args: string[], options: CommandOptions): Promise<void>;

  // ------------------------------------------------------------ plumbing

  /**
   * Bind the style the kernel wants this command to write through.
   */
  setStyle(style: OutputStyle): this {
    this.outputStyle = style;
    return this;
  }

  /**
   * The active output style, created with auto-detection if unbound.
   */
  getStyle(): OutputStyle {
    if (this.outputStyle === null) {
      this.outputStyle = new OutputStyle();
    }

    return this.outputStyle;
  }

  /**
   * Bind the parsed input so `argument()`/`option()` can read it.
   */
  setInput(input: CommandInput): this {
    this.input = input;
    return this;
  }

  /**
   * The structured command signature (parsed lazily and memoized).
   */
  getDefinition(): ParsedSignature {
    if (this.parsedSignature === null) {
      this.parsedSignature = CommandSignature.parse(this.signature);
    }

    return this.parsedSignature;
  }

  /**
   * Get the command name from the signature.
   */
  getName(): string {
    return this.getDefinition().name;
  }

  // ----------------------------------------------------------- input API

  /**
   * Read a named argument resolved through the signature binding.
   */
  protected argument(name: string): string | string[] | null {
    this.requireInput('argument');
    return (this.input as CommandInput).getArgument(name);
  }

  /**
   * Read a named option (canonical or shortcut).
   */
  protected option(name: string): unknown {
    this.requireInput('option');
    return (this.input as CommandInput).getOption(name);
  }

  protected hasArgument(name: string): boolean {
    return this.getDefinition().arguments.some((argument) => argument.name === name);
  }

  protected hasOption(name: string): boolean {
    return this.getDefinition().options.some((option) => option.name === name || option.shortcut === name);
  }

  private requireInput(kind: string): void {
    if (this.input === null) {
      throw new Error(
        `Cannot read ${kind} on "${this.getName()}": no input is bound. Run the command through the console kernel.`
      );
    }
  }

  // ---------------------------------------------------------- output API

  /**
   * Write a green information message.
   */
  protected info(message: string): void {
    this.getStyle().info(message);
  }

  /**
   * Write a bold green success message.
   */
  protected success(message: string): void {
    this.getStyle().success(message);
  }

  /**
   * Write a red error message to the error channel.
   */
  protected error(message: string): void {
    this.getStyle().error(message);
  }

  /**
   * Write a yellow warning to the warn channel.
   */
  protected warn(message: string): void {
    this.getStyle().warning(message);
  }

  /**
   * Write a yellow warning (Symfony-style alias of `warn`).
   */
  protected warning(message: string): void {
    this.getStyle().warning(message);
  }

  /**
   * Write a dark gray comment.
   */
  protected comment(message: string): void {
    this.getStyle().comment(message);
  }

  /**
   * Write a cyan question message.
   */
  protected question(message: string): void {
    this.getStyle().question(message);
  }

  /**
   * Write a plain line.
   */
  protected line(message: string = ''): void {
    this.getStyle().line(message);
  }

  /**
   * Write `count` blank lines.
   */
  protected newLine(count: number = 1): void {
    this.getStyle().newLine(count);
  }

  /**
   * Write a bordered table.
   */
  protected table(headers: string[], rows: unknown[][]): void {
    this.getStyle().table(headers, rows);
  }

  /**
   * Render a progress bar.
   */
  protected progress(max: number, current: number = 0): void {
    this.getStyle().progress(max, current);
  }

  /**
   * Animate a spinner, optionally while an async task runs.
   */
  protected spin<T>(message: string, callback?: () => Promise<T> | T): Promise<T | void> {
    return this.getStyle().spin(message, callback);
  }

  // ---------------------------------------------------------- prompt API

  /**
   * Ask a question. Non-interactive sessions return `fallback` immediately.
   */
  protected ask(
    question: string,
    fallback: string = '',
    validate?: (value: string) => string | null | undefined
  ): Promise<string> {
    return this.getStyle().ask(question, fallback, validate);
  }

  /**
   * Ask a hidden question (password prompt).
   */
  protected secret(question: string, fallback: string = ''): Promise<string> {
    return this.getStyle().secret(question, fallback);
  }

  /**
   * Ask a yes/no question.
   */
  protected confirm(question: string, fallback: boolean = false): Promise<boolean> {
    return this.getStyle().confirm(question, fallback);
  }

  /**
   * Ask the user to pick from a list.
   */
  protected choice(question: string, choices: string[], fallback?: string | number): Promise<string> {
    return this.getStyle().choice(question, choices, fallback);
  }

  /**
   * Prompt with single-match autocompletion from `choices`.
   */
  protected anticipate(question: string, choices: string[], fallback: string = ''): Promise<string> {
    return this.getStyle().anticipate(question, choices, fallback);
  }
}
