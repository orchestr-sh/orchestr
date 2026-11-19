/**
 * Stringable
 *
 * A fluent string wrapper, the Support counterpart to Laravel's
 * Illuminate\Support\Stringable. Orchestr keeps `Str` purely static, so
 * `Stringable` is the object end of the same vocabulary: every method hands
 * the underlying string to the matching `Str` helper and wraps the result
 * again.
 *
 * The value serializes as a plain string, so a Stringable can travel through
 * `JSON.stringify()` or template interpolation without leaking an object.
 *
 * @example
 * ```typescript
 * new Stringable('Hello World').lower().trim().toString(); // 'hello world'
 * Stringable.of('laravel').slug();                          // 'laravel'
 * ```
 */

import { Str } from './Str';

export class Stringable {
  constructor(protected contents: string = '') {}

  /**
   * Create a new instance from the given value
   * Laravel: Str::of()
   */
  static of(value: any = ''): Stringable {
    return new Stringable(value === null || value === undefined ? '' : String(value));
  }

  /**
   * The underlying string
   */
  value(): string {
    return this.contents;
  }

  /**
   * Convert the object to its string representation
   */
  toString(): string {
    return this.contents;
  }

  /**
   * Hook used by template literals and String()
   */
  valueOf(): string {
    return this.contents;
  }

  /**
   * Hook used by JSON.stringify
   */
  toJSON(): string {
    return this.contents;
  }

  /**
   * Determine if the string is empty
   */
  isEmpty(): boolean {
    return this.contents === '';
  }

  /**
   * Determine if the string is empty or whitespace-only
   */
  isBlank(): boolean {
    return Str.isBlank(this.contents);
  }

  /**
   * Determine if the string has content
   */
  isFilled(): boolean {
    return Str.isFilled(this.contents);
  }

  /**
   * Length of the string
   */
  length(): number {
    return Str.length(this.contents);
  }

  /**
   * Trim whitespace (or the given characters) from both ends
   */
  trim(characters?: string): Stringable {
    if (characters === undefined) {
      return new Stringable(this.contents.trim());
    }

    const pattern = new RegExp(`^[${escapeRegExp(characters)}]+|[${escapeRegExp(characters)}]+$`, 'g');

    return new Stringable(this.contents.replace(pattern, ''));
  }

  /**
   * Lowercase the string
   */
  lower(): Stringable {
    return new Stringable(Str.lower(this.contents));
  }

  /**
   * Uppercase the string
   */
  upper(): Stringable {
    return new Stringable(Str.upper(this.contents));
  }

  /**
   * Title-case the string
   */
  title(): Stringable {
    return new Stringable(Str.title(this.contents));
  }

  /**
   * Convert to camelCase
   */
  camel(): Stringable {
    return new Stringable(Str.camel(this.contents));
  }

  /**
   * Convert to snake_case
   */
  snake(delimiter = '_'): Stringable {
    return new Stringable(Str.snake(this.contents, delimiter));
  }

  /**
   * Convert to studly (Pascal) case
   */
  studly(): Stringable {
    return new Stringable(Str.studly(this.contents));
  }

  /**
   * Convert to kebab-case
   */
  kebab(): Stringable {
    return new Stringable(Str.kebab(this.contents));
  }

  /**
   * Convert to a URL-friendly slug
   */
  slug(separator = '-', language = 'en'): Stringable {
    return new Stringable(Str.slug(this.contents, separator, language));
  }

  /**
   * Append the given values to the string
   */
  append(...values: any[]): Stringable {
    return new Stringable(this.contents + values.map((value) => String(value)).join(''));
  }

  /**
   * Prepend the given values to the string
   */
  prepend(...values: any[]): Stringable {
    return new Stringable(values.map((value) => String(value)).join('') + this.contents);
  }

  /**
   * Determine if the string contains the given needle(s)
   */
  contains(needles: string | string[], ignoreCase = false): boolean {
    return Str.contains(this.contents, needles, ignoreCase);
  }

  /**
   * Determine if the string starts with the given needle(s)
   */
  startsWith(needles: string | string[]): boolean {
    return Str.startsWith(this.contents, needles);
  }

  /**
   * Determine if the string ends with the given needle(s)
   */
  endsWith(needles: string | string[]): boolean {
    return Str.endsWith(this.contents, needles);
  }

  /**
   * Replace every occurrence of the search string
   */
  replace(search: string, replacement: string): Stringable {
    return new Stringable(this.contents.split(search).join(replacement));
  }

  /**
   * Replace the first occurrence of the search string
   */
  replaceFirst(search: string, replacement: string): Stringable {
    return new Stringable(Str.replaceFirst(search, replacement, this.contents));
  }

  /**
   * Replace the last occurrence of the search string
   */
  replaceLast(search: string, replacement: string): Stringable {
    return new Stringable(Str.replaceLast(search, replacement, this.contents));
  }

  /**
   * The remainder after the first occurrence of the given value
   */
  after(search: string): Stringable {
    return new Stringable(Str.after(this.contents, search));
  }

  /**
   * The portion before the first occurrence of the given value
   */
  before(search: string): Stringable {
    return new Stringable(Str.before(this.contents, search));
  }

  /**
   * Limit the string to the given number of characters
   */
  limit(limit: number | null = null, end = '...'): Stringable {
    return new Stringable(Str.limit(this.contents, limit, end));
  }

  /**
   * Determine if the string matches the given pattern(s)
   */
  is(pattern: string | string[]): boolean {
    return Str.is(pattern, this.contents);
  }

  /**
   * Split the string on the given delimiter into a plain array
   */
  split(by = ' ', limit?: number): string[] {
    const parts = by === '' ? Array.from(this.contents) : this.contents.split(by);

    return limit === undefined || limit <= 0 ? parts : parts.slice(0, limit);
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
