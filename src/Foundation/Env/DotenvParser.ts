/**
 * DotenvParser
 *
 * Parses the contents of a `.env` file in a dotenv-compatible way, mirroring
 * the features Laravel relies on (via vlucas/phpdotenv):
 *
 * - blank lines and `#` comment lines
 * - `export KEY=value` prefixes
 * - single-quoted (literal) and double-quoted (escape-processed) values
 * - multi-line quoted values
 * - inline comments after unquoted or quoted values
 * - `${VAR}` and `${VAR:-fallback}` expansion from previously defined
 *   variables and the process environment
 *
 * Values are returned as strings. Boolean/null/empty coercion
 * (`true`, `false`, `null`, `empty` and their parenthesised forms) happens
 * when values are read back through `Env.get()` / the `env()` helper, exactly
 * like Laravel's `env()` helper.
 */
export class DotenvParser {
  /**
   * Parse dotenv-formatted contents into a record of raw string values.
   *
   * Later entries override earlier ones for duplicate keys within a file.
   */
  static parse(content: string): Record<string, string> {
    const vars: Record<string, string> = {};
    const lines = content.split(/\r?\n/);

    for (let index = 0; index < lines.length; index++) {
      const line = lines[index].trim();

      // Skip blank lines and whole-line comments.
      if (line === '' || line.startsWith('#')) {
        continue;
      }

      // Support the `export KEY=value` form.
      const body = line.replace(/^export[ \t]+/, '');

      const separator = body.indexOf('=');
      if (separator === -1) {
        continue; // Not a KEY=value line; ignore like dotenv does.
      }

      const key = body.slice(0, separator).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(key)) {
        continue;
      }

      const raw = body.slice(separator + 1).trim();
      const quote = raw.charAt(0);

      if (quote === '"' || quote === "'") {
        const isDoubleQuoted = quote === '"';
        let text = raw.slice(1);
        let closed = false;
        let position = 0;

        // Scan to the closing quote, allowing the value to span lines and
        // (for double quotes) treating backslash escapes as escaped content.
        while (!closed) {
          while (position < text.length) {
            const char = text.charAt(position);

            if (isDoubleQuoted && char === '\\') {
              position += 2;
              continue;
            }

            if (char === quote) {
              closed = true;
              break;
            }

            position++;
          }

          if (!closed) {
            if (index + 1 < lines.length) {
              index++;
              text += '\n' + lines[index];
              position = text.length - lines[index].length - 1;
            } else {
              // Unterminated quote: treat the rest of the input as the value.
              closed = true;
              break;
            }
          }
        }

        const inner = text.slice(0, position);

        if (isDoubleQuoted) {
          // Double quotes: process escape sequences first (`\$` survives as a
          // literal backslash-dollar), then expand `${VAR}` references.
          // Expanding last ensures inserted values are never re-unescaped.
          vars[key] = DotenvParser.expand(DotenvParser.unescape(inner), vars);
        } else {
          // Single-quoted values are fully literal: no expansion, no escapes.
          vars[key] = inner;
        }

        continue;
      }

      // Unquoted value: strip inline comments (` # ...`), then expand.
      vars[key] = DotenvParser.expand(raw.replace(/(^|[ \t])#.*$/, '').trim(), vars);
    }

    return vars;
  }

  /**
   * Process backslash escape sequences found inside double-quoted values.
   * Unknown sequences keep their backslash so Windows paths survive intact.
   */
  private static unescape(text: string): string {
    let output = '';

    for (let i = 0; i < text.length; i++) {
      const char = text[i];

      if (char !== '\\' || i + 1 >= text.length) {
        output += char;
        continue;
      }

      const next = text[++i];

      switch (next) {
        case 'n':
          output += '\n';
          break;
        case 'r':
          output += '\r';
          break;
        case 't':
          output += '\t';
          break;
        case '\\':
          output += '\\';
          break;
        case '"':
          output += '"';
          break;
        case "'":
          output += "'";
          break;
        default:
          output += '\\' + next;
      }
    }

    return output;
  }

  /**
   * Expand `${VAR}` references from variables defined earlier in the same
   * file first, then the process environment. Missing variables expand to an
   * empty string unless a `${VAR:-fallback}` default is provided.
   *
   * An escaped dollar (`\$`) is shielded with a sentinel during expansion so
   * `\${VAR}` yields the literal text `${VAR}` instead of the value, the
   * same way dotenv-expand protects it.
   */
  private static expand(value: string, vars: Record<string, string>): string {
    const ESCAPED_DOLLAR = '\u0000';

    const shielded = value.replace(/\\\$/g, ESCAPED_DOLLAR);

    const expanded = shielded.replace(/\$\{([^}]*)\}/g, (_reference, expression: string) => {
      const separator = expression.indexOf(':-');
      const name = separator === -1 ? expression : expression.slice(0, separator);
      const fallback = separator === -1 ? '' : expression.slice(separator + 2);

      const resolved = vars[name] ?? process.env[name];

      return resolved !== undefined ? resolved : fallback;
    });

    return expanded.split(ESCAPED_DOLLAR).join('$');
  }
}
