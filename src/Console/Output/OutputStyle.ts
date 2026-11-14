/**
 * OutputStyle
 *
 * The single output surface every command uses, mirroring Symfony's
 * `SymfonyStyle` / Laravel's `$this->components` + `$this->output` helpers.
 *
 * Design notes:
 *
 * - All standard output goes through an injectable writer that defaults to
 *   `console.log`, warnings to `console.warn`, and errors to `console.error`
 *   so output remains observable (and assertable) in the same channels the
 *   framework's commands have always used.
 * - Colour is applied per style when decorated; `line()` is always plain,
 *   matching Laravel where unstyled writes are verbatim. Decoration follows
 *   `NO_COLOR` / `FORCE_COLOR` / TTY detection via `AnsiColor.detect`.
 * - `quiet` (`--quiet`/`-q`) silences every write, as in Artisan.
 * - Prompts (`ask`, `secret`, `confirm`, `choice`, `anticipate`) delegate to
 *   the `Prompter` and resolve to their default without ever hanging when
 *   the session is not interactive.
 */

import { AnsiColor, AnsiStyle } from './AnsiColor';
import { Prompter, PromptValidator } from './Prompter';

export interface OutputWriter {
  /** Standard output channel. */
  log(message: string): void;
  /** Warning channel. */
  warn(message: string): void;
  /** Error channel. */
  error(message: string): void;
  /** Raw stream write used for in-place progress/spin rendering. */
  write(chunk: string): void;
}

export interface OutputStyleOptions {
  /** Force ANSI decoration on/off; auto-detected when omitted. */
  decorated?: boolean;
  /** Silence every write (`--quiet`). */
  quiet?: boolean;
  /** Verbosity level 0..3 coming from `-v`/`-vv`/`-vvv`. */
  verbosity?: number;
  /** Allow interactive prompts; auto-detected from stdin when omitted. */
  interactive?: boolean;
  /** Overwrite in place (progress/spin); follows stdout TTY when omitted. */
  overwrite?: boolean;
  /** Override any of the default console-based writers (tests, embedders). */
  writer?: Partial<OutputWriter>;
}

const SPIN_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export class OutputStyle {
  private decoratedFlag: boolean;
  private quietFlag: boolean;
  private verbosityLevel: number;
  private interactiveFlag: boolean;
  private overwriteFlag: boolean | null;
  private prompter: Prompter;
  private writer: OutputWriter;

  constructor(options: OutputStyleOptions = {}) {
    this.decoratedFlag = options.decorated ?? AnsiColor.detect();
    this.quietFlag = options.quiet ?? false;
    this.verbosityLevel = options.verbosity ?? 1;
    this.interactiveFlag = options.interactive ?? process.stdin.isTTY === true;
    this.overwriteFlag = options.overwrite ?? null;
    this.writer = {
      log: (message: string) => console.log(message),
      warn: (message: string) => console.warn(message),
      error: (message: string) => console.error(message),
      write: (chunk: string) => process.stdout.write(chunk),
      ...options.writer,
    };

    this.prompter = new Prompter(
      () => this.isInteractive() && !this.quietFlag,
      (message: string) => this.line(message)
    );
  }

  // --------------------------------------------------------------- styling

  isDecorated(): boolean {
    return this.decoratedFlag;
  }

  setDecorated(decorated: boolean): this {
    this.decoratedFlag = decorated;
    return this;
  }

  isQuiet(): boolean {
    return this.quietFlag;
  }

  setQuiet(quiet: boolean = true): this {
    this.quietFlag = quiet;
    return this;
  }

  getVerbosity(): number {
    return this.verbosityLevel;
  }

  setVerbosity(verbosity: number): this {
    this.verbosityLevel = verbosity;
    return this;
  }

  isVerbose(): boolean {
    return this.verbosityLevel >= 1 && !this.quietFlag;
  }

  isVeryVerbose(): boolean {
    return this.verbosityLevel >= 2 && !this.quietFlag;
  }

  isDebug(): boolean {
    return this.verbosityLevel >= 3 && !this.quietFlag;
  }

  isInteractive(): boolean {
    return this.interactiveFlag;
  }

  setInteractive(interactive: boolean): this {
    this.interactiveFlag = interactive;
    return this;
  }

  // -------------------------------------------------------------- writing

  /**
   * Write a plain line (never decorated, even with colour enabled).
   */
  line(message: string = ''): void {
    this.write(message, 'log');
  }

  /**
   * Green information message.
   */
  info(message: string): void {
    this.styled(message, 'info', 'log');
  }

  /**
   * Bold green success message.
   */
  success(message: string): void {
    this.styled(message, 'success', 'log');
  }

  /**
   * Yellow warning, routed through the warn channel (`console.warn`).
   */
  warning(message: string): void {
    this.styled(message, 'warning', 'warn');
  }

  /**
   * Red error, routed through the error channel (`console.error`).
   */
  error(message: string): void {
    this.styled(message, 'error', 'error');
  }

  /**
   * Dark gray comment.
   */
  comment(message: string): void {
    this.styled(message, 'comment', 'log');
  }

  /**
   * Cyan question marker.
   */
  question(message: string): void {
    this.styled(message, 'question', 'log');
  }

  /**
   * Emit `count` blank lines.
   */
  newLine(count: number = 1): void {
    for (let index = 0; index < count; index++) {
      this.write('', 'log');
    }
  }

  /**
   * Render a bordered table of rows under the given headers.
   */
  table(headers: string[], rows: unknown[][]): void {
    const stringRows = rows.map((row) => row.map(formatCell));
    const columns = Math.max(headers.length, ...stringRows.map((row) => row.length), 1);

    const widths: number[] = [];

    for (let column = 0; column < columns; column++) {
      const header = headers[column] ?? '';
      let width = AnsiColor.strip(header).length;

      for (const row of stringRows) {
        width = Math.max(width, AnsiColor.strip(row[column] ?? '').length);
      }

      widths.push(width);
    }

    const separator = `+${widths.map((width) => '-'.repeat(width + 2)).join('+')}+`;
    const renderRow = (cells: string[]): string =>
      `| ${cells.map((cell, column) => pad(AnsiColor.strip(cell), widths[column])).join(' | ')} |`;

    const lines = [
      separator,
      renderRow(Array.from({ length: columns }, (_, column) => headers[column] ?? '')),
      separator,
    ];

    for (const row of stringRows) {
      lines.push(renderRow(Array.from({ length: columns }, (_, column) => row[column] ?? '')));
    }

    lines.push(separator);

    this.write(lines.join('\n'), 'log');
  }

  /**
   * Render a progress bar. On a TTY the bar overwrites itself in place;
   * anywhere else each update is emitted as a line so output stays
   * observable for logs and tests.
   */
  progress(max: number, current: number = 0): void {
    if (this.quietFlag) {
      return;
    }

    const ratio = max > 0 ? Math.min(1, Math.max(0, current / max)) : 1;
    const barWidth = 30;
    const filled = Math.round(ratio * barWidth);
    const bar = '='.repeat(filled) + '.'.repeat(barWidth - filled);
    const percent = Math.round(ratio * 100);
    const text = `${String(current).padStart(String(max).length)}/${max} [${bar}] ${String(percent).padStart(3)}%`;

    if (this.canOverwrite()) {
      this.writer.write(`\r${text}`);

      if (current >= max) {
        this.writer.write('\n');
      }

      return;
    }

    this.writer.log(text);
  }

  /**
   * Animate a spinner while an async callback runs, then clear it. Without
   * a callback a single spinner line is emitted. Non-TTY output degrades to
   * a plain line so nothing spins forever or leaks timers into tests.
   */
  async spin<T>(message: string, callback?: () => Promise<T> | T): Promise<T | void> {
    if (callback === undefined) {
      if (this.quietFlag) {
        return;
      }

      const text = `${SPIN_FRAMES[0]} ${message}`;

      if (this.canOverwrite()) {
        this.writer.write(text);
      } else {
        this.writer.log(text);
      }

      return;
    }

    if (this.quietFlag || !this.canOverwrite()) {
      return callback();
    }

    let frame = 0;

    this.writer.write(`\r${SPIN_FRAMES[0]} ${message}`);

    const interval = setInterval(() => {
      frame = (frame + 1) % SPIN_FRAMES.length;
      this.writer.write(`\r${SPIN_FRAMES[frame]} ${message}`);
    }, 80);

    try {
      return await callback();
    } finally {
      clearInterval(interval);
      this.writer.write(`\r${' '.repeat(message.length + 2)}\r`);
    }
  }

  // -------------------------------------------------------------- prompts

  /**
   * Ask a free-form question; returns `fallback` when non-interactive.
   */
  async ask(question: string, fallback: string = '', validate?: PromptValidator): Promise<string> {
    return this.prompter.ask(question, fallback, validate);
  }

  /**
   * Ask a question without echoing the answer; returns `fallback` when
   * non-interactive.
   */
  async secret(question: string, fallback: string = ''): Promise<string> {
    return this.prompter.secret(question, fallback);
  }

  /**
   * Yes/no question; returns `fallback` when non-interactive.
   */
  async confirm(question: string, fallback: boolean = false): Promise<boolean> {
    return this.prompter.confirm(question, fallback);
  }

  /**
   * Choose from a list; returns the resolved `fallback` (index or value,
   * first choice by default) when non-interactive.
   */
  async choice(question: string, choices: string[], fallback?: string | number): Promise<string> {
    return this.prompter.choice(question, choices, fallback);
  }

  /**
   * Prompt with single-match autocompletion; returns `fallback` when
   * non-interactive or when the answer is ambiguous.
   */
  async anticipate(question: string, choices: string[], fallback: string = ''): Promise<string> {
    return this.prompter.anticipate(question, choices, fallback);
  }

  // ------------------------------------------------------------- internal

  private styled(message: string, style: AnsiStyle, channel: 'log' | 'warn' | 'error'): void {
    if (this.quietFlag) {
      return;
    }

    this.writer[channel](AnsiColor.apply(style, message, this.decoratedFlag));
  }

  private write(message: string, channel: 'log' | 'error'): void {
    if (this.quietFlag) {
      return;
    }

    this.writer[channel](message);
  }

  private canOverwrite(): boolean {
    return this.overwriteFlag ?? process.stdout.isTTY === true;
  }
}

function pad(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - text.length));
}

/**
 * Stringify a table cell, falling back to JSON for plain objects so grids
 * never render `[object Object]`.
 */
function formatCell(cell: unknown): string {
  switch (typeof cell) {
    case 'string':
      return cell;
    case 'bigint':
    case 'boolean':
    case 'number':
      return String(cell);
    case 'object':
      return cell === null ? '' : JSON.stringify(cell);
    default:
      return '';
  }
}
