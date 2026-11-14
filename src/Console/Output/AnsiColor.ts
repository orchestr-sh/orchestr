/**
 * AnsiColor
 *
 * ANSI colour codes and decoration detection for console output, mirroring
 * the parts of Symfony's `Terminal` that matter here:
 *
 * - `NO_COLOR` (any non-empty value) disables colour everywhere.
 * - `FORCE_COLOR` (any value other than empty/`0`) enables colour even when
 *   the stream is not a TTY.
 * - Otherwise colour follows the stdout TTY flag, so piped output and test
 *   harnesses receive plain text.
 */

export type AnsiStyle = 'info' | 'success' | 'warning' | 'error' | 'comment' | 'question';

const CODES: Record<AnsiStyle, string> = {
  info: '32', // green
  success: '1;32', // bold green
  warning: '33', // yellow
  error: '31', // red
  comment: '90', // dark gray
  question: '36', // cyan
};

export class AnsiColor {
  /**
   * Decide whether styled output should be decorated with ANSI escapes.
   */
  static detect(env: NodeJS.ProcessEnv = process.env, isTty: boolean = process.stdout.isTTY === true): boolean {
    const noColor = env.NO_COLOR;

    if (noColor !== undefined && noColor !== '') {
      return false;
    }

    const forceColor = env.FORCE_COLOR;

    if (forceColor !== undefined && forceColor !== '' && forceColor !== '0') {
      return true;
    }

    return isTty;
  }

  /**
   * Wrap `text` in the escape codes for a named style (plain when disabled).
   */
  static apply(style: AnsiStyle, text: string, decorated: boolean = true): string {
    if (!decorated) {
      return text;
    }

    return `\x1b[${CODES[style]}m${text}\x1b[0m`;
  }

  /**
   * Remove every ANSI escape sequence from `text` (used by tests and by the
   * table renderer when measuring column widths of decorated strings).
   */
  static strip(text: string): string {
    // The ESC control character is intentional: this matches real ANSI sequences.
    // eslint-disable-next-line no-control-regex
    return text.replace(/\x1b\[[0-9;]*m/g, '');
  }
}
