/**
 * DotenvWriter
 *
 * The counterpart to DotenvParser: edits a single entry in `.env` file
 * contents without disturbing anything else on the file. Comments, blank
 * lines, and every other variable keep their exact position; an existing
 * `KEY=` line (in `export` or quoted forms) is replaced in place, and a
 * missing key is appended.
 *
 * SRP: parsing lives in DotenvParser, environment access in Env; this class
 * only produces updated file text. Laravel spreads this behaviour across
 * `key:generate` and vlucas/phpdotenv's repository writes; the port keeps it
 * in one testable place.
 */

/** One line matched as a dotenv entry, with the key and parsed value. */
interface EntryMatch {
  key: string;
  value: string;
}

export class DotenvWriter {
  private static readonly entryPattern = /^([ \t]*)(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_.]*)[ \t]*=[ \t]*/;

  /**
   * The current raw value of `key` in the given contents, or null when the
   * file does not define it. Inline comments and surrounding quotes are
   * stripped the way DotenvParser would strip them.
   */
  static get(content: string, key: string): string | null {
    for (const line of content.split(/\r?\n/)) {
      const parsed = DotenvWriter.matchEntry(line);

      if (parsed && parsed.key === key) {
        return parsed.value;
      }
    }

    return null;
  }

  /**
   * Return contents with `key` set to `value`: the first matching entry line
   * is rewritten in place; otherwise the assignment is appended, preserving
   * the file's original trailing-newline style.
   */
  static set(content: string, key: string, value: string): string {
    const assignment = `${key}=${DotenvWriter.quote(value)}`;
    const lines = content.split(/\r?\n/);

    for (let index = 0; index < lines.length; index++) {
      const parsed = DotenvWriter.matchEntry(lines[index]);

      if (parsed && parsed.key === key) {
        lines[index] = assignment;
        return lines.join('\n');
      }
    }

    // Empty files get the entry alone; anything else appends below what is
    // there, inserting the separating newline only when one is missing.
    if (content === '') {
      return assignment + '\n';
    }

    return (content.endsWith('\n') ? content : content + '\n') + assignment + '\n';
  }

  /**
   * Match one line as a dotenv entry. Comment lines never match; the value
   * is the raw remainder with inline comments and one layer of quotes
   * removed, mirroring DotenvParser's surface rules.
   */
  private static matchEntry(line: string): EntryMatch | null {
    if (line.trim().startsWith('#')) {
      return null;
    }

    const match = DotenvWriter.entryPattern.exec(line);

    if (!match) {
      return null;
    }

    const raw = line.slice(match.index + match[0].length).trim();
    const withoutComment = raw.replace(/(^|[ \t])#.*$/, '').trim();

    return {
      key: match[2],
      value: DotenvWriter.stripQuotes(withoutComment),
    };
  }

  /**
   * Render a value for the file: quote anything dotenv would misread
   * (whitespace, `#`, quotes, backslashes, empty strings); leave simple
   * values bare, the way Laravel ships `APP_KEY=base64:...`.
   */
  private static quote(value: string): string {
    if (value !== '' && !/["'\\\s#]/.test(value)) {
      return value;
    }

    return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }

  /**
   * Remove one layer of matching quotes from a raw value.
   */
  private static stripQuotes(value: string): string {
    const quoted = /^"([\s\S]*)"$/.exec(value) ?? /^'([\s\S]*)'$/.exec(value);

    return quoted ? quoted[1] : value;
  }
}
