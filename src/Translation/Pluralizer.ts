/**
 * Pluralizer - picks one of a line's `|` separated forms for a count
 * Illuminate\Translation\MessageSelector (choice lines)
 *
 * Supports Laravel/Symfony's two selection styles:
 *
 * - explicit specs: `{0} None|[1,19] A few|[20,*] A lot` - `{n}` matches
 *   an exact count, `[min,max]` an inclusive range with `*` as an open
 *   bound, and the first matching segment wins
 * - ordinal forms: `There is one apple|There are :count apples` - the
 *   locale's plural rule (through `Intl.PluralRules`) picks the index,
 *   so two-form locales use singular only for "one" while locales with
 *   richer systems (few/many) address more forms
 *
 * Living beside - not inside - the Translator keeps translating and
 * pluralizing separate concerns (SRP).
 */

/**
 * Canonical message-order of the plural categories; the rule tables in
 * Laravel/Symfony list the locale's categories in this order, e.g. a
 * Russian `one|few|many|other` line.
 */
const CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'];

const EXACT_SPEC = /^\{\s*(-?\d+)\s*\}\s*(.*)$/s;
const RANGE_SPEC = /^\[\s*(-?\d+|\*)\s*,\s*(-?\d+|\*)\s*\]\s*(.*)$/s;

interface Spec {
  matches: (count: number) => boolean;
  text: string;
}

export class Pluralizer {
  /**
   * Choose the form of `line` for `count` under `locale`.
   */
  choose(line: string, count: number, locale: string = 'en'): string {
    const segments = line.split('|').map((segment) => segment.trim());

    const specs = segments.map((segment) => this.parseSpec(segment));

    if (specs.some((spec) => spec !== null)) {
      for (const spec of specs) {
        if (spec !== null && spec.matches(count)) {
          return spec.text;
        }
      }

      // No spec matched: Symfony falls back to the unqualified line,
      // then to the last segment with its spec removed.
      const unqualified = segments.find((segment) => this.parseSpec(segment) === null);

      if (unqualified !== undefined) {
        return unqualified;
      }

      const last = specs[specs.length - 1];

      return last !== null ? last.text : segments[segments.length - 1];
    }

    if (segments.length === 1) {
      return segments[0];
    }

    return segments[this.index(count, segments.length, locale)];
  }

  /**
   * Resolve one segment's `{n}` / `[min,max]` prefix, or null when the
   * segment carries no spec.
   */
  private parseSpec(segment: string): Spec | null {
    const exact = EXACT_SPEC.exec(segment);

    if (exact) {
      const value = Number(exact[1]);

      return { matches: (count) => count === value, text: exact[2].trim() };
    }

    const range = RANGE_SPEC.exec(segment);

    if (range) {
      const min = range[1] === '*' ? Number.NEGATIVE_INFINITY : Number(range[1]);
      const max = range[2] === '*' ? Number.POSITIVE_INFINITY : Number(range[2]);

      return { matches: (count) => count >= min && count <= max, text: range[3].trim() };
    }

    return null;
  }

  /**
   * The ordinal form for a count: the locale's plural category maps onto
   * the forms in the locale's canonical category order.
   */
  private index(count: number, forms: number, locale: string): number {
    const category = this.category(count, locale);
    const order = Pluralizer.ruleOrder(locale);

    let position = order.indexOf(category);

    if (position === -1) {
      position = order.length - 1;
    }

    return Math.min(position, forms - 1);
  }

  /**
   * The categories a locale actually distinguishes, in canonical message
   * order - `one|few|many|other` for Russian, `one|other` for English.
   */
  private static rules = new Map<string, string[]>();

  private static ruleOrder(locale: string): string[] {
    const cached = Pluralizer.rules.get(locale);

    if (cached !== undefined) {
      return cached;
    }

    let categories: string[];

    try {
      categories = new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
    } catch {
      categories = ['one', 'other'];
    }

    const order = CATEGORIES.filter((category) => categories.includes(category));
    const resolved = order.length > 0 ? order : ['one', 'other'];

    Pluralizer.rules.set(locale, resolved);

    return resolved;
  }

  private category(count: number, locale: string): string {
    try {
      return new Intl.PluralRules(locale).select(count);
    } catch {
      // Unknown locale tags fall back to the English rule (count 1 is
      // singular, everything else plural), like Symfony's default.
      return Math.abs(count) === 1 ? 'one' : 'other';
    }
  }
}
