/**
 * Prompter
 *
 * Interactive console prompts built on `node:readline`, mirroring the
 * `ask`, `secret`, `confirm`, `choice`, and `anticipate` helpers of Laravel's
 * `Illuminate\Console\ViewCompressor`-era `Command` helpers (`$this->ask()`,
 * `$this->confirm()`, ...).
 *
 * The golden rule for every prompt: when the session is not interactive
 * (`--no-interaction`, a closed/redirected stdin, `--quiet`) the default is
 * returned immediately and readline is never touched, so automation can
 * never hang waiting for input. Even in the interactive path the promise
 * settles with the default if stdin closes before an answer arrives.
 */

import { createInterface } from 'node:readline';

/**
 * Optional validator for `ask`. Returning a non-empty string marks the
 * answer invalid and re-prompts with that message.
 */
export type PromptValidator = (value: string) => string | null | undefined;

export type PromptChoice = string;

const MAX_ATTEMPTS = 10;

export class Prompter {
  constructor(
    private interactive: () => boolean,
    /** Hook used to show validation errors between re-prompts. */
    private notify: (message: string) => void = () => undefined
  ) {}

  /**
   * Free-form question. Empty answers fall back to `fallback`; a validator
   * can reject an answer and re-prompt.
   */
  async ask(question: string, fallback: string = '', validate?: PromptValidator): Promise<string> {
    if (!this.interactive()) {
      return fallback;
    }

    const hint = fallback === '' ? '' : ` [${fallback}]`;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const raw = await this.line(`${question}${hint}: `);
      const value = raw.trim() === '' ? fallback : raw;

      if (validate === undefined) {
        return value;
      }

      const error = validate(value);

      if (error === null || error === undefined || error === '') {
        return value;
      }

      this.notify(error);
    }

    throw new Error(`Too many invalid answers for prompt "${question}".`);
  }

  /**
   * Password-style question that does not echo the typed answer.
   */
  async secret(question: string, fallback: string = ''): Promise<string> {
    if (!this.interactive()) {
      return fallback;
    }

    const raw = await this.line(`${question}: `, true);

    return raw.trim() === '' ? fallback : raw;
  }

  /**
   * Yes/no question. Accepts `y|yes|n|no` case-insensitively; an empty
   * answer returns `fallback`.
   */
  async confirm(question: string, fallback: boolean = false): Promise<boolean> {
    if (!this.interactive()) {
      return fallback;
    }

    const hint = fallback ? '(Y/n)' : '(y/N)';

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const raw = (await this.line(`${question} ${hint}: `)).trim().toLowerCase();

      if (raw === '') {
        return fallback;
      }

      if (raw === 'y' || raw === 'yes' || raw === 'true' || raw === '1') {
        return true;
      }

      if (raw === 'n' || raw === 'no' || raw === 'false' || raw === '0') {
        return false;
      }

      this.notify('Please answer y or n.');
    }

    throw new Error(`Too many invalid answers for prompt "${question}".`);
  }

  /**
   * Selection from a list of choices. The answer may be a numeric index or
   * the choice text (case-insensitive). `fallback` may be an index, a value,
   * or undefined (first choice).
   */
  async choice(question: string, choices: PromptChoice[], fallback?: string | number): Promise<string> {
    const resolvedFallback = this.resolveFallback(choices, fallback);

    if (!this.interactive()) {
      return resolvedFallback;
    }

    const listing = choices.map((choice, index) => `  [${index}] ${choice}`).join('\n');
    const prompt = `${question}\n${listing}\n >`;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const raw = (await this.line(prompt)).trim();

      if (raw === '') {
        return resolvedFallback;
      }

      const byIndex = this.matchIndex(raw, choices);

      if (byIndex !== undefined) {
        return byIndex;
      }

      const byText = this.matchText(raw, choices);

      if (byText !== undefined) {
        return byText;
      }

      this.notify(`"${raw}" is not a listed choice.`);
    }

    throw new Error(`Too many invalid answers for prompt "${question}".`);
  }

  /**
   * Autocompletion-style prompt: an answer that matches exactly one choice
   * (ignoring case, prefix allowed) resolves to that choice; anything else
   * falls back to `fallback`.
   */
  async anticipate(question: string, choices: PromptChoice[], fallback: string = ''): Promise<string> {
    if (!this.interactive()) {
      return fallback;
    }

    const raw = (await this.line(`${question} [${choices.join(', ')}]: `)).trim();

    if (raw === '') {
      return fallback;
    }

    const matches = this.matchTextAll(raw, choices);

    if (matches.length === 1) {
      return matches[0];
    }

    return fallback;
  }

  /**
   * Read a single answer line. When `hide` is set, readline runs in
   * non-terminal mode so typed characters are not echoed.
   */
  protected line(question: string, hide: boolean = false): Promise<string> {
    return new Promise<string>((resolve) => {
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: hide ? false : undefined,
      });

      let settled = false;

      const done = (answer: string): void => {
        if (settled) {
          return;
        }

        settled = true;
        rl.close();
        resolve(answer);
      };

      // stdin closing before an answer (pipes, redirected input) must never
      // leave the promise pending.
      rl.on('close', () => done(''));
      rl.question(question, done);
    });
  }

  private resolveFallback(choices: PromptChoice[], fallback?: string | number): string {
    if (typeof fallback === 'number') {
      return choices[fallback] ?? '';
    }

    if (typeof fallback === 'string' && fallback !== '') {
      return this.matchText(fallback, choices) ?? fallback;
    }

    return choices[0] ?? '';
  }

  private matchIndex(raw: string, choices: PromptChoice[]): string | undefined {
    if (!/^\d+$/.test(raw)) {
      return undefined;
    }

    const index = Number(raw);

    return index < choices.length ? choices[index] : undefined;
  }

  private matchText(raw: string, choices: PromptChoice[]): string | undefined {
    const matches = this.matchTextAll(raw, choices);

    return matches.length === 1 ? matches[0] : matches.find((choice) => choice.toLowerCase() === raw.toLowerCase());
  }

  private matchTextAll(raw: string, choices: PromptChoice[]): string[] {
    const needle = raw.toLowerCase();
    const exact = choices.filter((choice) => choice.toLowerCase() === needle);

    if (exact.length > 0) {
      return exact;
    }

    return choices.filter((choice) => choice.toLowerCase().startsWith(needle));
  }
}
