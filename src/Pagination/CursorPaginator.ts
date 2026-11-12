/**
 * CursorPaginator
 *
 * The pagination object for cursor navigation: instead of page numbers it
 * carries encoded points into the ordered result, so pages stay stable while
 * rows are inserted or deleted. Mirrors Illuminate\Pagination\CursorPaginator;
 * the builder that ran the ordered query hands the page over already in
 * display order.
 */

import { UrlGenerator } from '@/Routing/UrlGenerator';
import { Collection } from '@/Support/Collection';
import type { CursorDirection } from './Cursor';
import { resolvePaginationOptions } from './AbstractPaginator';
import { serializePaginatedItem } from './AbstractPaginator';
import { Cursor } from './Cursor';

export interface CursorPaginationOptions {
  path?: string;
  query?: Record<string, any>;
  fragment?: string;

  /**
   * The name of the query parameter carrying the encoded cursor
   */
  cursorName?: string;

  /**
   * The ordering the page was fetched with: column to direction
   */
  index?: Record<string, CursorDirection>;

  /**
   * Whether more rows exist after this page
   */
  hasMore?: boolean;

  /**
   * Whether more rows exist before this page
   */
  hasPrevious?: boolean;
}

export class CursorPaginator<T = any> {
  /**
   * The items on this page, in display order
   */
  protected itemsValue: Collection<T>;

  /**
   * The number of items shown per page
   */
  protected perPageValue: number;

  /**
   * The cursor this page was fetched from, null for the first page
   */
  protected cursorValue: Cursor | null;

  /**
   * The ordering cursor points are taken over
   */
  protected indexValue: Record<string, CursorDirection>;

  protected pathValue: string;
  protected queryValue: Record<string, any>;
  protected cursorNameValue: string;
  protected fragmentValue: string;

  private hasMoreValue: boolean;
  private hasPreviousValue: boolean;

  constructor(
    items: Collection<T> | T[],
    perPage: number,
    cursor: Cursor | null = null,
    options: CursorPaginationOptions = {}
  ) {
    const resolved = resolvePaginationOptions(options);

    this.itemsValue = items instanceof Collection ? items : new Collection<T>(items as T[]);
    this.perPageValue = perPage;
    this.cursorValue = cursor;
    this.indexValue = options.index ?? {};
    this.pathValue = resolved.path;
    this.queryValue = resolved.query;
    this.cursorNameValue = options.cursorName ?? 'cursor';
    this.fragmentValue = resolved.fragment;
    this.hasMoreValue = options.hasMore ?? false;
    this.hasPreviousValue = options.hasPrevious ?? false;
  }

  /**
   * The items on this page as a collection
   */
  get items(): Collection<T> {
    return this.itemsValue;
  }

  /**
   * The items on this page as a plain array
   */
  get data(): T[] {
    return this.itemsValue.all();
  }

  /**
   * The number of items shown per page
   */
  get perPage(): number {
    return this.perPageValue;
  }

  /**
   * The cursor this page was fetched from
   */
  cursor(): Cursor | null {
    return this.cursorValue;
  }

  /**
   * The number of items on this page
   */
  count(): number {
    return this.itemsValue.count();
  }

  /**
   * Determine whether the page is empty
   */
  isEmpty(): boolean {
    return this.itemsValue.isEmpty();
  }

  /**
   * Determine whether the page carries items
   */
  isNotEmpty(): boolean {
    return !this.isEmpty();
  }

  /**
   * Determine whether more rows exist after this page
   * Laravel: CursorPaginator::hasMorePages()
   */
  hasMorePages(): boolean {
    return this.hasMoreValue;
  }

  /**
   * Determine whether rows exist before this page
   */
  hasPreviousPages(): boolean {
    return this.hasPreviousValue;
  }

  /**
   * Determine whether this page starts the ordered result
   */
  onFirstPage(): boolean {
    return !this.hasPreviousValue;
  }

  /**
   * The cursor of the page after this one, or null at the end
   * Laravel: CursorPaginator::nextCursor()
   */
  nextCursor(): Cursor | null {
    if (!this.hasMoreValue || this.itemsValue.isEmpty()) {
      return null;
    }

    return this.pointCursor(this.itemsValue.last(), 'forward');
  }

  /**
   * The cursor of the page before this one, or null at the start
   * Laravel: CursorPaginator::previousCursor()
   */
  previousCursor(): Cursor | null {
    if (!this.hasPreviousValue || this.itemsValue.isEmpty()) {
      return null;
    }

    return this.pointCursor(this.itemsValue.first(), 'back');
  }

  /**
   * The URL of the page after this one, or null
   */
  nextPageUrl(): string | null {
    const cursor = this.nextCursor();

    return cursor === null ? null : this.url(cursor);
  }

  /**
   * The URL of the page before this one, or null
   */
  previousPageUrl(): string | null {
    const cursor = this.previousCursor();

    return cursor === null ? null : this.url(cursor);
  }

  /**
   * Build a cursor link; no cursor is the very first page
   * Laravel: CursorPaginator::url()
   */
  url(cursor?: Cursor | null): string {
    const parameters = { ...this.queryValue };

    if (cursor !== undefined && cursor !== null) {
      parameters[this.cursorNameValue] = cursor.toEncoded();
    }

    const query = UrlGenerator.toQuery(parameters);
    const separator = this.pathValue.includes('?') ? '&' : '?';
    const hash = this.fragmentValue === '' ? '' : `#${this.fragmentValue}`;

    if (query === '') {
      return `${this.pathValue}${hash}`;
    }

    return `${this.pathValue}${separator}${query}${hash}`;
  }

  /**
   * Add query parameters to every generated link
   */
  appends(key: string | Record<string, any>, value?: any): this {
    if (typeof key === 'string') {
      this.queryValue[key] = value;
    } else {
      Object.assign(this.queryValue, key);
    }

    return this;
  }

  /**
   * Get or set the URL fragment appended to every generated link
   */
  fragment(fragment?: string): this {
    if (fragment !== undefined && fragment !== null) {
      this.fragmentValue = fragment;
    }

    return this;
  }

  /**
   * Set the path links are built on
   */
  setPath(path: string): this {
    this.pathValue = path;
    return this;
  }

  /**
   * The path links are built on
   */
  getPath(): string {
    return this.pathValue;
  }

  /**
   * The first/last/next/previous link list
   * Laravel: CursorPaginator::links()
   */
  links(): { first: string; last: string | null; prev: string | null; next: string | null } {
    return {
      first: this.url(),
      last: this.lastCursor() === null ? null : this.url(this.lastCursor()),
      prev: this.previousPageUrl(),
      next: this.nextPageUrl(),
    };
  }

  /**
   * The cursor at the very end of the ordered result: the last one this
   * page produced, falling back to the one it was fetched from
   */
  lastCursor(): Cursor | null {
    return this.nextCursor() ?? this.cursorValue;
  }

  /**
   * The metadata resource collections merge into a paginated response
   * Laravel: CursorPaginator::meta()
   */
  meta(): Record<string, any> {
    return {
      next_cursor: this.nextCursor()?.toEncoded() ?? null,
      prev_cursor: this.previousCursor()?.toEncoded() ?? null,
    };
  }

  /**
   * The cursor pagination as JSON data
   * Laravel: CursorPaginator::toArray()
   */
  toArray(): Record<string, any> {
    return {
      data: this.itemsValue.all().map((item) => serializePaginatedItem(item)),
      links: this.links(),
      path: this.pathValue,
      per_page: this.perPageValue,
    };
  }

  /**
   * Serialize the pagination to a JSON string
   */
  toJson(spacing: number | string = 0): string {
    return JSON.stringify(this.toArray(), null, spacing);
  }

  /**
   * JSON.stringify hook so an embedded paginator serialises through toArray()
   */
  toJSON(): Record<string, any> {
    return this.toArray();
  }

  /**
   * Take the ordered point of one item and wrap it in a travelling cursor
   */
  private pointCursor(item: T | undefined, travel: 'forward' | 'back'): Cursor | null {
    if (item === undefined || Object.keys(this.indexValue).length === 0) {
      return null;
    }

    const parameters: Record<string, any> = {};

    for (const column of Object.keys(this.indexValue)) {
      const value = CursorPaginator.pointValue(item, column);

      if (value === undefined) {
        return null;
      }

      parameters[column] = value;
    }

    return new Cursor(parameters, this.indexValue, travel === 'back' ? { travel: 'back' } : {});
  }

  /**
   * The value an ordered column holds on one row: models are read through
   * their attributes, plain records by the (last) segment of the column name
   */
  private static pointValue(item: any, column: string): any {
    if (typeof item.getAttribute === 'function') {
      const direct = item.getAttribute(column);

      if (direct !== undefined) {
        return direct;
      }
    }

    const leaf = column.includes('.') ? column.slice(column.lastIndexOf('.') + 1) : column;

    if (typeof item.getAttribute === 'function') {
      return item.getAttribute(leaf);
    }

    return item[leaf];
  }
}
