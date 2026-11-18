/**
 * Translator - resolves localized lines for Laravel-style keys
 * Illuminate\Translation\Translator
 *
 * Owns *what a key means*, not where lines come from: storage is the
 * TranslationLoader's job and form selection is the Pluralizer's (SRP),
 * so new formats plug in without touching this class (OCP).
 *
 * Key grammar: `package::group.nested.key`; without `::` the application
 * language roots answer, and a bare `key` reads the flat '{locale}.json'
 * lines. Lookup walks the fallback chain - the active locale first, then
 * the fallback locale - and an unknown key answers with the key itself,
 * like Laravel. Retrieved lines go through `:name` replacement;
 * `choice()` additionally selects one of the line's `|` forms and
 * provides `:count` / `%count%` automatically.
 */

import { Arr } from '@/Support/Arr';
import type { TranslationLines, TranslationLoader } from './Contracts/TranslationLoader';
import type { ReplacementValues } from './Replacer';
import { FileLoader } from './FileLoader';
import { Pluralizer } from './Pluralizer';
import { Replacer } from './Replacer';

/**
 * A translation key split into its parts.
 */
export interface ParsedTranslationKey {
  /** Package namespace, '*' for application lines. */
  namespace: string;
  /** Language file/group, '*' for the flat {locale}.json lines. */
  group: string;
  /** Dot path inside the group's lines. */
  item: string;
}

/**
 * Split `package::file.nested.key` into its parts (Laravel: parseKey).
 */
export function parseTranslationKey(key: string): ParsedTranslationKey {
  let namespace = '*';
  let rest = key;

  const separator = rest.indexOf('::');

  if (separator !== -1) {
    namespace = rest.slice(0, separator);
    rest = rest.slice(separator + 2);
  }

  const dot = rest.indexOf('.');

  if (dot === -1) {
    return { namespace, group: '*', item: rest };
  }

  return { namespace, group: rest.slice(0, dot), item: rest.slice(dot + 1) };
}

export class Translator {
  /** Resolved lines keyed by `locale|namespace|group`. */
  private cache: Map<string, TranslationLines> = new Map();

  /** In-flight module loads, so lazy lookups kick the import only once. */
  private pending: Map<string, Promise<void>> = new Map();

  constructor(
    protected readonly loader: TranslationLoader,
    protected locale: string = 'en',
    protected fallback: string = 'en',
    private readonly pluralizer: Pluralizer = new Pluralizer()
  ) {}

  // ---------------------------------------------------------------------
  // Locales
  // ---------------------------------------------------------------------

  getLocale(): string {
    return this.locale;
  }

  setLocale(locale: string): void {
    this.locale = locale;
  }

  getFallback(): string {
    return this.fallback;
  }

  setFallback(fallback: string): void {
    this.fallback = fallback;
  }

  /**
   * The locales this translator can serve: everything the loader knows
   * about, plus the active and fallback locales. Used by the
   * Accept-Language middleware to pick a supported locale.
   */
  locales(): string[] {
    const discovered = this.loader.locales ? this.loader.locales() : [];

    return [...new Set([...discovered, this.locale, this.fallback])].sort((left, right) => left.localeCompare(right));
  }

  // ---------------------------------------------------------------------
  // Line sources
  // ---------------------------------------------------------------------

  /**
   * Register a package language root (`package::file.key`).
   * Laravel: Translator::addNamespace()
   */
  addNamespace(namespace: string, path: string): this {
    if (this.loader.addNamespace) {
      this.loader.addNamespace(namespace, path);
    }

    return this;
  }

  /**
   * Register a directory holding flat `{locale}.json` lines.
   * Laravel: Translator::addJsonPath()
   */
  addJsonPath(path: string): this {
    if (this.loader.addJsonPath) {
      this.loader.addJsonPath(path);
    }

    return this;
  }

  /**
   * Merge lines into the translator programmatically - tests and packages
   * that ship lines in code rather than on disk. Any lines the loader
   * already has for the group are kept as the base (deep-merged).
   * Laravel: Translator::addLines()
   */
  addLines(lines: TranslationLines, group: string, locale: string = this.locale, namespace: string = '*'): this {
    // Seed the cache from the loader first so programmatic lines merge
    // over the file lines instead of replacing the whole group.
    this.ensure(locale, namespace, group);
    this.store(this.cacheKey(locale, namespace, group), lines);

    return this;
  }

  /**
   * Await every group the loader reports for a locale so module-based
   * language files are usable from synchronous get()/has() calls.
   */
  async preload(locale: string = this.locale): Promise<void> {
    const groups = new Set<string>(this.loader.groups ? this.loader.groups(locale) : []);

    groups.add('*');

    await Promise.all([...groups].map((group) => this.ensureAsync(locale, '*', group)));
  }

  // ---------------------------------------------------------------------
  // Retrieval
  // ---------------------------------------------------------------------

  /**
   * Get the translation for a key, applying `:name` replacements.
   * Laravel: Translator::get() / trans()
   */
  get(key: string, replacements: ReplacementValues = {}, locale?: string): string {
    const parsed = parseTranslationKey(key);
    const line = this.rawLine(parsed, locale);

    return Replacer.make(line ?? key, replacements);
  }

  /**
   * Alias of get(), mirroring the trans() helper.
   */
  trans(key: string, replacements: ReplacementValues = {}, locale?: string): string {
    return this.get(key, replacements, locale);
  }

  /**
   * Determine whether a translation line exists for the key.
   * Laravel: Translator::has()
   */
  has(key: string, locale?: string): boolean {
    return this.rawLine(parseTranslationKey(key), locale) !== null;
  }

  /**
   * Get a pluralized translation: the line's `|` forms are narrowed by
   * the count (see Pluralizer) and `:count` / `%count%` are provided
   * automatically alongside any explicit replacements.
   * Laravel: Translator::choice() / trans_choice()
   */
  choice(key: string, number: number = 1, replacements: ReplacementValues = {}, locale?: string): string {
    const parsed = parseTranslationKey(key);
    const active = locale ?? this.locale;
    const line = this.rawLine(parsed, locale) ?? key;
    const chosen = line.includes('|') ? this.pluralizer.choose(line, number, active) : line;

    return Replacer.make(chosen.replaceAll('%count%', String(number)), { count: number, ...replacements });
  }

  /**
   * Alias of choice(), mirroring the trans_choice() helper.
   */
  transChoice(key: string, number: number = 1, replacements: ReplacementValues = {}, locale?: string): string {
    return this.choice(key, number, replacements, locale);
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  /**
   * Resolve a key's raw line (no replacements) down the fallback chain:
   * requested/active locale first, fallback locale second. Containers
   * (objects like `validation.min`'s size variants) are not lines.
   */
  private rawLine(parsed: ParsedTranslationKey, locale?: string): string | null {
    for (const candidate of this.chain(locale)) {
      const lines = this.ensure(candidate, parsed.namespace, parsed.group);

      if (lines === null) {
        continue;
      }

      const value = Arr.get(lines, parsed.item);

      if (value !== undefined && value !== null && typeof value !== 'object') {
        return String(value);
      }
    }

    return null;
  }

  /**
   * The locale fallback chain for a lookup.
   */
  private chain(locale?: string): string[] {
    const primary = locale ?? this.locale;

    return primary === this.fallback ? [primary] : [primary, this.fallback];
  }

  private cacheKey(locale: string, namespace: string, group: string): string {
    return `${locale}|${namespace}|${group}`;
  }

  /**
   * Synchronously resolve a group's lines: cached hits first, then the
   * loader. Promises (module files) are adopted when they settle; the
   * current call answers null so the caller falls back.
   */
  private ensure(locale: string, namespace: string, group: string): TranslationLines | null {
    const key = this.cacheKey(locale, namespace, group);
    const cached = this.cache.get(key);

    if (cached !== undefined) {
      return cached;
    }

    const loaded = this.loader.load(locale, namespace, group);

    if (loaded === null || loaded === undefined) {
      return null;
    }

    if (isPromiseLike(loaded)) {
      if (!this.pending.has(key)) {
        const settled = Promise.resolve(loaded)
          .then((lines) => {
            if (lines !== null && lines !== undefined) {
              this.store(key, lines);
            }
          })
          .catch(() => undefined)
          .then(() => {
            this.pending.delete(key);
          });

        this.pending.set(key, settled);
      }

      return null;
    }

    this.store(key, loaded);

    return this.cache.get(key) ?? null;
  }

  /**
   * Await one group's lines - the async twin of ensure(), used by
   * preload() so module-based files become synchronously readable.
   */
  private async ensureAsync(locale: string, namespace: string, group: string): Promise<void> {
    const key = this.cacheKey(locale, namespace, group);

    const inflight = this.pending.get(key);

    if (inflight !== undefined) {
      await inflight;
      return;
    }

    const loaded = this.loader.load(locale, namespace, group);

    if (loaded === null || loaded === undefined) {
      return;
    }

    if (isPromiseLike(loaded)) {
      await Promise.resolve(loaded).then((lines) => {
        if (lines !== null && lines !== undefined) {
          this.store(key, lines);
        }
      });

      return;
    }

    this.store(key, loaded);
  }

  /**
   * Merge incoming lines into the cache without mutating objects the
   * loader (or a test) keeps a reference to.
   */
  private store(key: string, incoming: TranslationLines): void {
    this.cache.set(key, mergeLines(this.cache.get(key) ?? {}, incoming));
  }
}

/**
 * Recursive merge of plain objects; later values win, arrays replace.
 */
function mergeLines(target: TranslationLines, source: TranslationLines): TranslationLines {
  const merged: TranslationLines = { ...target };

  for (const [name, value] of Object.entries(source)) {
    if (isPlainObject(value) && isPlainObject(merged[name])) {
      merged[name] = mergeLines(merged[name], value);
    } else if (isPlainObject(value)) {
      merged[name] = mergeLines({}, value);
    } else {
      merged[name] = value;
    }
  }

  return merged;
}

function isPlainObject(value: unknown): value is TranslationLines {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPromiseLike<T>(value: unknown): value is PromiseLike<T> {
  return typeof (value as PromiseLike<T>)?.then === 'function';
}

/**
 * The process-wide translator used by `__()` / `trans()` /
 * `trans_choice()` and the Lang facade when no application has bound a
 * 'translator' service - answers with the key (plus replacements) so
 * standalone scripts behave like missing translations in Laravel.
 */
let globalTranslator: Translator | null = null;

export function defaultTranslator(): Translator {
  if (globalTranslator === null) {
    globalTranslator = new Translator(new FileLoader([]));
  }

  return globalTranslator;
}
