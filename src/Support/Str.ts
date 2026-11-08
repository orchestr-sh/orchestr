/**
 * Str Class
 *
 * A TypeScript port of Illuminate\Support\Str, providing the everyday
 * string helpers Laravel developers expect. All methods are static and
 * free of framework / container dependencies so they are safe to use in
 * any context.
 *
 * Notes:
 * - Length, slicing and padding operate on Unicode code points, like
 *   PHP's mb_* functions, rather than UTF-16 units.
 * - `ascii` / `slug` transliterate through an internal character map
 *   plus Unicode NFKD decomposition. Common Latin and Cyrillic scripts
 *   are covered; exotic scripts fall back to stripping the character.
 * - `plural` / `singular` implement a compact, ordered inflection table
 *   inspired by the doctrine/inflector ruleset Laravel ships with. It
 *   covers the regular patterns, the bundled irregulars and the
 *   uncountable list, but is not a full port of every inflection rule.
 */

import { randomBytes, randomUUID } from 'crypto';

/** An inflection rule: match the tail of a word case-insensitively and replace it. */
type InflectionRule = {
  pattern: RegExp;
  replace: string;
};

/** An irregular singular/plural pair. */
type IrregularWord = {
  singular: string;
  plural: string;
  /** When true, the pair only matches at a "word boundary" (ox => oxen, but not box => boxes). */
  boundary?: boolean;
};

const ALPHA_NUM = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

const CROCKFORD_BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Language specific transliteration maps, applied before generic Unicode
 * decomposition (mirrors the roles/language tables used by
 * Illuminate\Support\Str::ascii).
 */
const TRANSLITERATE_MAPS: Record<string, Record<string, string>> = {
  de: {
    Ä: 'AE',
    Ö: 'OE',
    Ü: 'UE',
    ä: 'ae',
    ö: 'oe',
    ü: 'ue',
    ß: 'ss',
    '&': 'und',
  },
  fr: {
    Œ: 'OE',
    œ: 'oe',
    '&': 'et',
  },
  da: {
    Æ: 'AE',
    æ: 'ae',
    Ø: 'OE',
    ø: 'oe',
    Å: 'AA',
    å: 'aa',
  },
  ru: {
    а: 'a',
    б: 'b',
    в: 'v',
    г: 'g',
    д: 'd',
    е: 'e',
    ё: 'yo',
    ж: 'zh',
    з: 'z',
    и: 'i',
    й: 'j',
    к: 'k',
    л: 'l',
    м: 'm',
    н: 'n',
    о: 'o',
    п: 'p',
    р: 'r',
    с: 's',
    т: 't',
    у: 'u',
    ф: 'f',
    х: 'kh',
    ц: 'ts',
    ч: 'ch',
    ш: 'sh',
    щ: 'shch',
    ъ: 'u',
    ы: 'y',
    ь: '',
    э: 'e',
    ю: 'yu',
    я: 'ya',
    А: 'A',
    Б: 'B',
    В: 'V',
    Г: 'G',
    Д: 'D',
    Е: 'E',
    Ё: 'Yo',
    Ж: 'Zh',
    З: 'Z',
    И: 'I',
    Й: 'J',
    К: 'K',
    Л: 'L',
    М: 'M',
    Н: 'N',
    О: 'O',
    П: 'P',
    Р: 'R',
    С: 'S',
    Т: 'T',
    У: 'U',
    Ф: 'F',
    Х: 'Kh',
    Ц: 'Ts',
    Ч: 'Ch',
    Ш: 'Sh',
    Щ: 'Shch',
    Ъ: 'U',
    Ы: 'Y',
    Ь: '',
    Э: 'E',
    Ю: 'Yu',
    Я: 'Ya',
  },
};

/** Default (English) replacements applied by Str::ascii. */
const ASCII_DEFAULT_REPLACEMENTS: Record<string, string> = {
  '&': 'and',
  '@': 'at',
  $: 'USD',
  '€': 'EUR',
  '£': 'GBP',
  '%': 'percent',
};

/** Words that are their own plural and singular (Laravel's "uncountable" list). */
const UNCOUNTABLE_WORDS = [
  'equipment',
  'information',
  'rice',
  'money',
  'species',
  'series',
  'fish',
  'sheep',
  'jeans',
  'police',
];

/**
 * Irregular singular/plural pairs, consulted before the rule tables so
 * words like person/people keep their expected shape.
 */
const IRREGULAR_WORDS: IrregularWord[] = [
  { singular: 'person', plural: 'people' },
  { singular: 'woman', plural: 'women', boundary: true },
  { singular: 'man', plural: 'men', boundary: true },
  { singular: 'child', plural: 'children' },
  { singular: 'mouse', plural: 'mice' },
  { singular: 'louse', plural: 'lice' },
  { singular: 'goose', plural: 'geese', boundary: true },
  { singular: 'tooth', plural: 'teeth', boundary: true },
  { singular: 'foot', plural: 'feet', boundary: true },
  { singular: 'ox', plural: 'oxen', boundary: true },
];

const PLURAL_RULES: InflectionRule[] = [
  { pattern: /(quiz)$/i, replace: '$1zes' },
  { pattern: /^(n)ews$/i, replace: '$1ews' },
  { pattern: /(matr|vert|ind)(?:ix|ex)$/i, replace: '$1ices' },
  { pattern: /(x|ch|ss|sh)$/i, replace: '$1es' },
  { pattern: /([^aeiouy]|qu)y$/i, replace: '$1ies' },
  { pattern: /(hive)$/i, replace: '$1s' },
  { pattern: /(?:([^f])fe|([lr])f)$/i, replace: '$1$2ves' },
  { pattern: /sis$/i, replace: 'ses' },
  { pattern: /(alias|status)$/i, replace: '$1es' },
  { pattern: /(bu)s$/i, replace: '$1ses' },
  {
    pattern: /(octop|vir|homin|alumn|fung|cact|nucle|radi|stimul|syllab|termin)(?:us|i)$/i,
    replace: '$1i',
  },
  { pattern: /(buffal|tomat|potat|volcan|her)o$/i, replace: '$1oes' },
  { pattern: /(ax|test)is$/i, replace: '$1es' },
  { pattern: /([ti])um$/i, replace: '$1a' },
  { pattern: /([ti])a$/i, replace: '$1a' },
  { pattern: /s$/i, replace: 's' },
  { pattern: /$/i, replace: 's' },
];

const SINGULAR_RULES: InflectionRule[] = [
  { pattern: /(database)s$/i, replace: '$1' },
  { pattern: /(quiz)zes$/i, replace: '$1' },
  { pattern: /(matr)ices$/i, replace: '$1ix' },
  { pattern: /(vert|ind)ices$/i, replace: '$1ex' },
  { pattern: /^(ox)en$/i, replace: '$1' },
  { pattern: /(alias|status)(?:es)?$/i, replace: '$1' },
  {
    pattern: /(octop|vir|homin|alumn|fung|cact|nucle|radi|stimul|syllab|termin)(?:us|i)$/i,
    replace: '$1us',
  },
  { pattern: /(cris|test)(?:is|es)$/i, replace: '$1is' },
  { pattern: /^(a)x[ie]s$/i, replace: 'axis' },
  { pattern: /(shoe)s$/i, replace: '$1' },
  { pattern: /(potat|tomat|volcan|buffal|her)oes$/i, replace: '$1o' },
  { pattern: /(o)es$/i, replace: '$1' },
  { pattern: /(bus)(?:es)?$/i, replace: '$1' },
  { pattern: /(m|l)ice$/i, replace: '$1ouse' },
  { pattern: /(x|ch|ss|sh)es$/i, replace: '$1' },
  { pattern: /(m)ovies$/i, replace: '$1ovie' },
  { pattern: /(s)eries$/i, replace: '$1eries' },
  { pattern: /(sex)(?:es)?$/i, replace: '$1' },
  { pattern: /(move)(?:s)?$/i, replace: '$1' },
  { pattern: /([^aeiouy]|qu)ies$/i, replace: '$1y' },
  { pattern: /([lr])ves$/i, replace: '$1f' },
  { pattern: /(lea)ves$/i, replace: '$1f' },
  { pattern: /(n|l|w)ives$/i, replace: '$1ife' },
  { pattern: /(tive|hive)s$/i, replace: '$1' },
  { pattern: /([aeiou])ves$/i, replace: '$1ve' },
  { pattern: /([^f])ves$/i, replace: '$1fe' },
  { pattern: /((?:a)naly|(?:b)a|(?:d)iagno|(?:p)arenthe|(?:p)rogno|(?:s)ynop|(?:t)he)(?:sis|ses)$/i, replace: '$1sis' },
  { pattern: /(analy)(sis|ses)$/i, replace: '$1sis' },
  { pattern: /([ti])a$/i, replace: '$1um' },
  { pattern: /(n)ews$/i, replace: '$1ews' },
  { pattern: /(ss|us)$/i, replace: '$1' },
  { pattern: /s$/i, replace: '' },
];

/** Tail patterns whose words are already plural and must not change. */
const PLURAL_UNINFLICTED: RegExp[] = [/(?:people|children|mice|lice|geese|teeth|feet|oxen|men|women)$/i];

/** Tail patterns whose words are already singular and must not change. */
const SINGULAR_UNINFLICTED: RegExp[] = [/(?:people|children|mice|lice|geese|teeth|feet|oxen|men|women)$/i];

/**
 * Replace a `$n` backreference in an inflection replacement string with
 * the captured group from the match.
 */
function substituteCaptives(replacement: string, groups: string[]): string {
  return replacement.replace(/\$(\d+)/g, (_match, digit: string) => groups[Number(digit) - 1] ?? '');
}

/**
 * Case-align an inflection replacement onto the matched tail of a word so
 * "Person" pluralises to "People" while "person" stays lower case.
 */
function alignCase(matchedTail: string, replacement: string): string {
  const chars = Array.from(matchedTail);
  const first = chars[0] ?? '';

  if (first === first.toUpperCase() && first !== first.toLowerCase()) {
    const replacementChars = Array.from(replacement);

    return replacementChars[0].toUpperCase() + replacementChars.slice(1).join('');
  }

  return replacement.toLowerCase();
}

/**
 * Match a word tail case-insensitively against the last `length`
 * characters, so prefixes keep their original case ("Salesperson" =>
 * "Salespeople").
 */
function irregularTailMatches(value: string, word: string, boundary: boolean): boolean {
  const lower = value.toLowerCase();

  if (!lower.endsWith(word)) {
    return false;
  }

  if (!boundary) {
    return true;
  }

  const before = lower.charAt(lower.length - word.length - 1);

  return before === '' || !/[a-z]/.test(before);
}

/**
 * Apply the irregular pairs, transforming the matched tail while keeping
 * the uninflected prefix untouched.
 */
function applyIrregular(value: string, from: string, to: string, boundary: boolean): string {
  const tail = value.slice(value.length - from.length);

  return value.slice(0, value.length - from.length) + alignCase(tail, to);
}

function pluralizeIrregular(value: string): string | null {
  const lower = value.toLowerCase();

  for (const word of IRREGULAR_WORDS) {
    if (
      lower === word.plural ||
      (irregularTailMatches(value, word.plural, false) && !irregularTailMatches(value, word.singular, false))
    ) {
      // Already one of the known plural forms: leave it alone.
      return value;
    }
  }

  for (const word of IRREGULAR_WORDS) {
    if (irregularTailMatches(value, word.singular, Boolean(word.boundary))) {
      return applyIrregular(value, word.singular, word.plural, Boolean(word.boundary));
    }
  }

  return null;
}

function singularizeIrregular(value: string): string | null {
  const lower = value.toLowerCase();

  for (const word of UNCOUNTABLE_WORDS) {
    if (lower === word) {
      return value;
    }
  }

  for (const word of IRREGULAR_WORDS) {
    if (irregularTailMatches(value, word.plural, Boolean(word.boundary))) {
      return applyIrregular(value, word.plural, word.singular, Boolean(word.boundary));
    }
  }

  return null;
}

/**
 * Run the ordered rule set against a word, doctrine style: the first
 * rule whose anchored pattern matches wins and only the matched tail is
 * rewritten, keeping the prefix's original case.
 */
function applyInflectionRules(value: string, rules: InflectionRule[], uninflected: RegExp[]): string {
  const lower = value.toLowerCase();

  if (UNCOUNTABLE_WORDS.includes(lower)) {
    return value;
  }

  for (const pattern of uninflected) {
    if (pattern.test(lower)) {
      return value;
    }
  }

  for (const rule of rules) {
    const match = rule.pattern.exec(value);

    if (!match) {
      continue;
    }

    const groups = match.slice(1).map((group) => group ?? '');
    const replaced = substituteCaptives(rule.replace, groups);

    return value.slice(0, value.length - match[0].length) + alignCase(match[0], replaced);
  }

  return value;
}

export class Str {
  /**
   * Default length used by `random()` when no length is given, mirroring
   * Illuminate\Support\Str::random().
   */
  private static readonly RANDOM_DEFAULT_LENGTH = 16;

  /**
   * Default character limit used by `limit()`, mirroring
   * Illuminate\Support\Str::limit().
   */
  private static readonly LIMIT_DEFAULT = 100;

  /**
   * Default word limit used by `words()`, mirroring
   * Illuminate\Support\Str::words().
   */
  private static readonly WORDS_DEFAULT = 100;

  /**
   * Convert a string to camelCase.
   *
   * Str.camel('foo_bar') // 'fooBar'
   */
  static camel(value: string): string {
    const studly = Str.studly(value);

    if (studly.length === 0) {
      return studly;
    }

    return studly.charAt(0).toLowerCase() + studly.slice(1);
  }

  /**
   * Convert a string to StudlyCase (PascalCase).
   *
   * Str.studly('foo_bar') // 'FooBar'
   */
  static studly(value: string): string {
    const words = value
      .replace(/[-_]+/gu, ' ')
      .replace(/[^\p{L}\p{N} ]+/gu, '')
      .trim()
      .replace(/\s+/gu, ' ')
      .split(' ')
      .filter((word) => word !== '');

    return words
      .map((word) => {
        const chars = Array.from(word);

        return chars[0].toUpperCase() + chars.slice(1).join('');
      })
      .join('');
  }

  /**
   * Convert a string to snake_case.
   *
   * Str.snake('FooBar') // 'foo_bar'
   */
  static snake(value: string, delimiter = '_', lowerCase = true): string {
    const output = Str.studly(value)
      .replace(/([A-Z]+)([A-Z][a-z])/g, (_match, run: string, next: string) => run + delimiter + next)
      .replace(/([a-z\d])([A-Z])/g, (_match, prev: string, next: string) => prev + delimiter + next)
      .replace(/[- ]+/g, delimiter)
      .toLowerCase();

    return lowerCase ? output : output.toUpperCase();
  }

  /**
   * Convert a string to kebab-case.
   *
   * Str.kebab('FooBar') // 'foo-bar'
   */
  static kebab(value: string): string {
    return Str.snake(value, '-');
  }

  /**
   * Convert a string to title case. Mirrors PHP's
   * `mb_convert_case($value, MB_CASE_TITLE)`: every word is capitalised
   * and the remaining characters are lower-cased.
   *
   * Str.title('hello world') // 'Hello World'
   */
  static title(value: string): string {
    return value
      .toLowerCase()
      .replace(
        /(^|[^\p{L}\p{N}])(\p{L})/gu,
        (_match, boundary: string, letter: string) => boundary + letter.toUpperCase()
      );
  }

  /**
   * Convert a string to a human-readable headline.
   *
   * Str.headline('helloWorld') // 'Hello World'
   * Str.headline('foo_bar-baz') // 'Foo Bar Baz'
   */
  static headline(value: string): string {
    const spaced = value
      .replace(/[_-]+/g, ' ')
      .replace(/([a-z\d])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .replace(/\s+/g, ' ')
      .trim();

    return Str.title(spaced);
  }

  /**
   * Generate a URL friendly "slug" from a given string.
   *
   * Str.slug('Hello, World!') // 'hello-world'
   */
  static slug(value: string, separator = '-', language = 'en'): string {
    const safeSeparator = separator === '' ? '-' : separator;
    const dictionary: Record<string, string> = { '@': 'at' };
    let title = Str.transliterate(value, language);

    for (const [search, replace] of Object.entries(dictionary)) {
      title = title.split(search).join(replace);
    }

    const parts = title
      .split(/[\s_\-/]+/u)
      .map((part) => Str.studly(part))
      .filter((part) => part !== '')
      .map((part) => part.toLowerCase());

    const slug = parts
      .join('-')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '');

    return safeSeparator === '-' ? slug : slug.replace(/-/g, safeSeparator);
  }

  /**
   * Get the plural form of an English word.
   *
   * Str.plural('user') // 'users'
   * Str.plural('person') // 'people'
   * Str.plural('user', 1) // 'user'
   */
  static plural(value: string, count: number = 2): string {
    if (value === '' || Math.abs(count) === 1) {
      return value;
    }

    const irregular = pluralizeIrregular(value);

    if (irregular !== null) {
      return irregular;
    }

    return applyInflectionRules(value, PLURAL_RULES, PLURAL_UNINFLICTED);
  }

  /**
   * Get the singular form of an English word.
   *
   * Str.singular('users') // 'user'
   * Str.singular('people') // 'person'
   */
  static singular(value: string): string {
    const irregular = singularizeIrregular(value);

    if (irregular !== null) {
      return irregular;
    }

    return applyInflectionRules(value, SINGULAR_RULES, SINGULAR_UNINFLICTED);
  }

  /**
   * Determine if a given string contains a given substring.
   *
   * Str.contains('Hello World', 'World') // true
   * Str.contains('Hello World', 'world') // false (case sensitive by default)
   * Str.contains('Hello World', ['Hello', 'Goodbye']) // true
   */
  static contains(value: string, needles: string | string[], ignoreCase = false): boolean {
    const stack = (Array.isArray(needles) ? needles : [needles]).filter((needle) => needle !== '');
    const haystack = ignoreCase ? value.toLowerCase() : value;

    return stack.some((needle) => haystack.includes(ignoreCase ? needle.toLowerCase() : needle));
  }

  /**
   * Determine if a given string starts with a given substring.
   */
  static startsWith(value: string, needles: string | string[]): boolean {
    return Str.asNeedleArray(needles).some((needle) => value.startsWith(needle));
  }

  /**
   * Determine if a given string ends with a given substring.
   */
  static endsWith(value: string, needles: string | string[]): boolean {
    return Str.asNeedleArray(needles).some((needle) => value.endsWith(needle));
  }

  /**
   * Return the remainder of a string after the first occurrence of a given value.
   */
  static after(value: string, search: string): string {
    if (search === '') {
      return value;
    }

    const position = value.indexOf(search);

    return position === -1 ? value : value.slice(position + search.length);
  }

  /**
   * Return the remainder of a string after the last occurrence of a given value.
   */
  static afterLast(value: string, search: string): string {
    if (search === '') {
      return value;
    }

    const position = value.lastIndexOf(search);

    return position === -1 ? value : value.slice(position + search.length);
  }

  /**
   * Get the portion of a string before the first occurrence of a given value.
   */
  static before(value: string, search: string): string {
    if (search === '') {
      return value;
    }

    const position = value.indexOf(search);

    return position === -1 ? value : value.slice(0, position);
  }

  /**
   * Get the portion of a string before the last occurrence of a given value.
   */
  static beforeLast(value: string, search: string): string {
    if (search === '') {
      return value;
    }

    const position = value.lastIndexOf(search);

    return position === -1 ? value : value.slice(0, position);
  }

  /**
   * Get the portion of a string between two given values. Returns an empty
   * string when either value is missing.
   *
   * Str.between('--laravel--', '--', '--') // 'laravel'
   */
  static between(value: string, from: string, to: string): string {
    const start = value.indexOf(from);

    if (start === -1) {
      return '';
    }

    const end = value.indexOf(to, start + from.length);

    if (end === -1) {
      return '';
    }

    return value.slice(start + from.length, end);
  }

  /**
   * Get the smallest portion of the string between two given values.
   *
   * Str.betweenFirst('{{foo}}', '{{', '}}') // 'foo'
   */
  static betweenFirst(value: string, from: string, to: string): string {
    const start = value.indexOf(from);

    if (start === -1) {
      return value;
    }

    const end = value.indexOf(to, start);

    if (end === -1) {
      return value;
    }

    return value.slice(start + from.length, end);
  }

  /**
   * Replace the first occurrence of a given value in the string.
   */
  static replaceFirst(search: string, replace: string, subject: string, caseSensitive = true): string {
    if (search === '') {
      return subject;
    }

    const haystack = caseSensitive ? subject : subject.toLowerCase();
    const needle = caseSensitive ? search : search.toLowerCase();
    const position = haystack.indexOf(needle);

    if (position === -1) {
      return subject;
    }

    return subject.slice(0, position) + replace + subject.slice(position + search.length);
  }

  /**
   * Replace the last occurrence of a given value in the string.
   */
  static replaceLast(search: string, replace: string, subject: string, caseSensitive = true): string {
    if (search === '') {
      return subject;
    }

    const haystack = caseSensitive ? subject : subject.toLowerCase();
    const needle = caseSensitive ? search : search.toLowerCase();
    const position = haystack.lastIndexOf(needle);

    if (position === -1) {
      return subject;
    }

    return subject.slice(0, position) + replace + subject.slice(position + search.length);
  }

  /**
   * Replace a given value in the string sequentially with an array.
   *
   * Str.replaceArray('?', ['8am', 'New York'], 'I am meeting me wife at ? around ?')
   * // 'I am meeting me wife at 8am around New York'
   */
  static replaceArray(search: string, replace: string[], subject: string): string {
    let result = subject;

    for (const value of replace) {
      if (!result.includes(search)) {
        break;
      }

      result = Str.replaceFirst(search, value, result);
    }

    return result;
  }

  /**
   * Begin a string with a given value if it does not already start with it.
   *
   * Str.start('laravel.com', 'https://') // 'https://laravel.com'
   */
  static start(value: string, prefix: string): string {
    return Str.startsWith(value, prefix) ? value : prefix + value;
  }

  /**
   * Finish a string with a given value if it does not already end with it.
   *
   * Str.finish('laravel', '.php') // 'laravel.php'
   */
  static finish(value: string, cap: string): string {
    return Str.endsWith(value, cap) ? value : value + cap;
  }

  /**
   * Convert a string to lowercase.
   */
  static lower(value: string): string {
    return value.toLowerCase();
  }

  /**
   * Convert a string to uppercase.
   */
  static upper(value: string): string {
    return value.toUpperCase();
  }

  /**
   * Limit a string to the given number of characters and append the
   * "end" string. Mirrors Laravel's `Str::limit`, which truncates to the
   * given count and appends the end marker without breaking on words.
   *
   * Str.limit('The PHP framework for web artisans', 7) // 'The PHP...'
   */
  static limit(value: string, limit: number | null = null, end = '...'): string {
    const count = limit ?? Str.LIMIT_DEFAULT;
    const chars = Array.from(value);

    if (chars.length <= count) {
      return value;
    }

    const truncated = chars.slice(0, Math.max(count, 0)).join('');

    return `${truncated.replace(/\s+$/u, '')}${end}`;
  }

  /**
   * Limit the number of words in a string.
   *
   * Str.words('Hello world, this is PHP.', 2) // 'Hello world...'
   */
  static words(value: string, words: number | null = null, end = '...'): string {
    const count = words ?? Str.WORDS_DEFAULT;
    const match = new RegExp(`^\\s*(?:\\S+\\s*){1,${count}}`, 'u').exec(value);

    if (!match || Array.from(value).length === Array.from(match[0]).length) {
      return value;
    }

    return `${match[0].replace(/\s+$/u, '')}${end}`;
  }

  /**
   * Get the total number of words in a given string.
   */
  static wordCount(value: string): number {
    const trimmed = value.trim();

    if (trimmed === '') {
      return 0;
    }

    return trimmed.split(/\s+/u).length;
  }

  /**
   * Convert the given string to its ASCII equivalent.
   *
   * Str.ascii('café') // 'cafe'
   * Str.ascii('Grüezi', 'de') // 'Grueezi'
   */
  static ascii(value: string, language = 'en'): string {
    return Str.transliterate(value, language);
  }

  /**
   * Transliterate a UTF-8 value to ASCII using the language map (when
   * known), Unicode NFKD decomposition and mark stripping. Characters
   * that cannot be represented are removed.
   */
  static transliterate(value: string, language = 'en'): string {
    const map = { ...ASCII_DEFAULT_REPLACEMENTS, ...(TRANSLITERATE_MAPS[language] ?? {}) };
    const keys = Object.keys(map).sort((a, b) => b.length - a.length);
    let result = value;

    for (const key of keys) {
      result = result.split(key).join(map[key]);
    }

    result = result.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');

    return result.replace(/[\u{80}-\u{10ffff}]/gu, '');
  }

  /**
   * Mask a portion of a string with the given secret.
   *
   * Str.mask('123456789', '*') // '*********'
   * Str.mask('123456789', '*', 4) // '****56789'
   * Str.mask('123456789', '*', -4) // '12345****'
   */
  static mask(value: string, secret: string, index?: number | null): string {
    const chars = Array.from(value);
    const length = chars.length;
    const secretChars = Array.from(secret === '' ? '*' : secret).slice(0, Math.max(length, 0));

    let position = index === null || index === undefined ? length : Math.trunc(Number(index));

    position = position < 0 ? Math.max(position, -length) : Math.min(position, length);

    if (position === 0) {
      return value;
    }

    const count = Math.abs(position);
    let mask = '';

    while (Array.from(mask).length < count) {
      mask += secretChars.join('');
    }

    mask = Array.from(mask).slice(0, count).join('');

    return position > 0 ? mask + chars.slice(position).join('') : chars.slice(0, length - count).join('') + mask;
  }

  /**
   * Pad a string to a given length using the given characters on the left.
   *
   * Str.padLeft('5', 3, '0') // '005'
   */
  static padLeft(value: string, length: number, padString = ' '): string {
    return Str.pad(value, length, padString, 'left');
  }

  /**
   * Pad a string to a given length using the given characters on the right.
   *
   * Str.padRight('foo', 5, '-') // 'foo--'
   */
  static padRight(value: string, length: number, padString = ' '): string {
    return Str.pad(value, length, padString, 'right');
  }

  /**
   * Pad a string to the requested length (measured in code points).
   * Negative or shorter lengths leave the value untouched, like str_pad.
   */
  private static pad(value: string, length: number, padString: string, mode: 'left' | 'right'): string {
    const count = Math.trunc(Number(length));

    if (count <= 0) {
      return value;
    }

    const chars = Array.from(value);

    if (chars.length >= count) {
      return value;
    }

    const pads = Array.from(padString === '' ? ' ' : padString);
    const needed = count - chars.length;
    let padding = '';

    while (Array.from(padding).length < needed) {
      padding += pads.join('');
    }

    padding = Array.from(padding).slice(0, needed).join('');

    return mode === 'left' ? padding + value : value + padding;
  }

  /**
   * Get the length of the given string, counting Unicode code points.
   */
  static length(value: string): number {
    return Array.from(value).length;
  }

  /**
   * Get the string as an array of Unicode code points.
   */
  static characters(value: string): string[] {
    return Array.from(value);
  }

  /**
   * Determine if a given string matches a given wildcard pattern.
   * A `*` in the pattern matches any sequence of characters and `\*`
   * matches a literal asterisk, like Illuminate\Support\Str::is().
   *
   * Str.is('ham*', 'hamburg') // true
   */
  static is(pattern: string | string[], value: string | string[]): boolean {
    const patterns = Array.isArray(pattern) ? pattern : [pattern];
    const values = Array.isArray(value) ? value : [value];
    const placeholder = '\u0001';

    for (const eachPattern of patterns) {
      const quoted = eachPattern
        .replace(/\\\*/g, placeholder)
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .split(placeholder)
        .join('\\*');

      for (const eachValue of values) {
        if (new RegExp(`^${quoted}$`, 'su').test(eachValue)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Determine if a given string is 7 bit ASCII.
   */
  static isAscii(value: string): boolean {
    return !/[\u{80}-\u{10ffff}]/u.test(value);
  }

  /**
   * Determine if a given string is blank (empty or whitespace only).
   */
  static isBlank(value: string): boolean {
    return value.trim() === '';
  }

  /**
   * Determine if a given string is filled (not blank).
   */
  static isFilled(value: string): boolean {
    return !Str.isBlank(value);
  }

  /**
   * Generate a "random" ASCII string of a given length.
   *
   * Str.random(16) // e.g. '8ZGq2m0pXr9tLs4k'
   */
  static random(length: number | null = null): string {
    const count = length ?? Str.RANDOM_DEFAULT_LENGTH;

    if (count <= 0) {
      return '';
    }

    const bytes = randomBytes(count);
    let output = '';

    for (const byte of bytes) {
      output += ALPHA_NUM.charAt(byte % ALPHA_NUM.length);
    }

    return output;
  }

  /**
   * Generate a RFC 4122 version 4 UUID.
   */
  static uuid(): string {
    return randomUUID();
  }

  /**
   * Generate a time-ordered, 26 character ULID.
   */
  static ulid(): string {
    const timestamp = BigInt(Date.now()) & 0xffffffffffffn;
    const randomness = BigInt('0x' + randomBytes(10).toString('hex'));
    const bits = ((timestamp << 80n) | randomness).toString(2).padStart(128, '0');

    let output = '';

    for (let index = 0; index < 128; index += 5) {
      output += CROCKFORD_BASE32.charAt(parseInt(bits.slice(index, index + 5), 2));
    }

    return output;
  }

  /**
   * Normalise a needle argument into a string array. An empty set behaves
   * like Laravel's Str::provided(), matching against the empty string.
   */
  private static asNeedleArray(needles: string | string[]): string[] {
    const stack = Array.isArray(needles) ? needles : [needles];

    return stack.length === 0 ? [''] : stack;
  }
}
