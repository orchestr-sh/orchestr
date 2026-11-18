/**
 * Replacer - `:name` placeholder interpolation
 * Illuminate\Translation\MessageSelector::makeReplacements territory,
 * extracted so the Translator stays about *which* line to show, not how
 * tokens get substituted (SRP).
 *
 * Placeholders use Laravel's `:key` syntax with word-boundary matching
 * (`:cost` never touches `:costs`), and - like Laravel - honor the
 * capitalized (`:Key`) and upper (`:KEY`) variants of each placeholder
 * by adjusting the replacement's case to match.
 */

export type ReplacementValues = Record<string, string | number | boolean | null | undefined>;

/**
 * Escape a placeholder name for embedding in a RegExp.
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class Replacer {
  /**
   * Apply every replacement to the line. Keys may be given with or
   * without their leading colon; values are stringified.
   */
  static make(line: string, replacements: ReplacementValues): string {
    let result = line;

    for (const [rawKey, value] of Object.entries(replacements)) {
      if (value === undefined || value === null) {
        continue;
      }

      const name = rawKey.startsWith(':') ? rawKey.slice(1) : rawKey;
      const text = String(value);

      if (name === '') {
        continue;
      }

      result = Replacer.replaceToken(result, name, text);
      result = Replacer.replaceToken(result, Replacer.ucfirst(name), Replacer.ucfirst(text));
      result = Replacer.replaceToken(result, name.toUpperCase(), text.toUpperCase());
    }

    return result;
  }

  /**
   * Replace every `:token` occurrence that is not part of a longer word
   * (`:min` must not match inside `:minimum`).
   */
  private static replaceToken(line: string, token: string, value: string): string {
    const pattern = new RegExp(`:${escapeRegExp(token)}(?![A-Za-z0-9_])`, 'g');

    return line.replace(pattern, () => value);
  }

  private static ucfirst(value: string): string {
    return value === '' ? value : value[0].toUpperCase() + value.slice(1);
  }
}
