/**
 * AbstractPaginator
 *
 * The shared skeleton of the page-based paginators, mirroring
 * Illuminate\Pagination\AbstractPaginator. A paginator owns its metadata -
 * items, page size, current page, links - and nothing else; running the query
 * stays the builder's job and serialising models for HTTP stays the resource
 * layer's job.
 *
 * URLs are built on the shared `UrlGenerator::toQuery()` so existing query
 * string parameters are preserved in every generated link.
 */

import { UrlGenerator } from '@/Routing/UrlGenerator';
import { Collection } from '@/Support/Collection';
import { currentRequestPath, currentRequestQuery } from './PaginationContext';

/**
 * Where a paginator's links point and what they carry: the current path, the
 * query parameters to preserve, the name of the page parameter, and an
 * optional URL fragment.
 */
export interface PaginationOptions {
  path?: string;
  query?: Record<string, any>;
  pageName?: string;
  fragment?: string;
}

/**
 * Resolve the options every paginator constructor ends up with, filling the
 * ones the caller left out from the running request.
 */
export function resolvePaginationOptions(options: PaginationOptions = {}): Required<PaginationOptions> {
  return {
    path: options.path ?? currentRequestPath(),
    query: { ...currentRequestQuery(), ...options.query },
    pageName: options.pageName ?? 'page',
    fragment: options.fragment ?? '',
  };
}

/**
 * One entry of the windowed link list.
 */
export interface PaginationLink {
  url: string | null;
  label: string;
  active: boolean;
}

export abstract class AbstractPaginator<T = any> {
  /**
   * The models on this page
   */
  protected itemsValue: Collection<T>;

  /**
   * The number of items shown per page
   */
  protected perPageValue: number;

  /**
   * The page this paginator is looking at
   */
  protected currentPageValue: number;

  /**
   * The path links are built on
   */
  protected pathValue: string;

  /**
   * Query parameters preserved in every generated link
   */
  protected queryValue: Record<string, any>;

  /**
   * The name of the page query parameter
   */
  protected pageNameValue: string;

  /**
   * The URL fragment appended to every generated link
   */
  protected fragmentValue: string;

  constructor(items: Collection<T> | T[], perPage: number, currentPage: number = 1, options: PaginationOptions = {}) {
    const resolved = resolvePaginationOptions(options);

    this.itemsValue = items instanceof Collection ? items : new Collection<T>(items);
    this.perPageValue = perPage;
    this.currentPageValue = Math.max(Math.floor(currentPage) || 1, 1);
    this.pathValue = resolved.path;
    this.queryValue = resolved.query;
    this.pageNameValue = resolved.pageName;
    this.fragmentValue = resolved.fragment;
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
   * The page this paginator is looking at
   */
  get currentPage(): number {
    return this.currentPageValue;
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
   * The 1-based position of the first item on this page, or null when there
   * is nothing to show
   */
  firstItem(): number | null {
    if (this.itemsValue.isEmpty()) {
      return null;
    }

    return (this.currentPageValue - 1) * this.perPageValue + 1;
  }

  /**
   * The 1-based position of the last item on this page
   */
  lastItem(): number | null {
    const first = this.firstItem();

    return first === null ? null : first + this.itemsValue.count() - 1;
  }

  /**
   * The 1-based position of the first item, exposed under the JSON name
   * Laravel's pagination metadata uses
   */
  get from(): number | null {
    return this.firstItem();
  }

  /**
   * The 1-based position of the last item, exposed under the JSON name
   * Laravel's pagination metadata uses
   */
  get to(): number | null {
    return this.lastItem();
  }

  /**
   * Build the URL for a given page, preserving the current query parameters
   * (with the page parameter itself taking precedence) and the fragment
   * Laravel: AbstractPaginator::url()
   */
  url(page: number): string {
    if (page <= 0) {
      page = 1;
    }

    const parameters = { ...this.queryValue, [this.pageNameValue]: page };

    return this.buildUrl(parameters);
  }

  /**
   * The URL of the next page, or null when there is none
   */
  abstract nextPageUrl(): string | null;

  /**
   * The URL of the previous page, or null when on the first page
   * Laravel: AbstractPaginator::previousPageUrl()
   */
  previousPageUrl(): string | null {
    if (this.currentPageValue <= 1) {
      return null;
    }

    return this.url(this.currentPageValue - 1);
  }

  /**
   * Determine whether more pages exist after this one
   */
  abstract hasMorePages(): boolean;

  /**
   * Determine whether this is the first page
   */
  onFirstPage(): boolean {
    return this.currentPageValue <= 1;
  }

  /**
   * Determine whether this is the last page
   */
  onLastPage(): boolean {
    return !this.hasMorePages();
  }

  /**
   * Set the path links are built on
   * Laravel: AbstractPaginator::setPath()
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
   * Add query parameters to every generated link. Takes either a record or a
   * single key/value pair.
   * Laravel: AbstractPaginator::appends()
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
   * Re-read the running request's query string into the preserved parameters
   * Laravel: AbstractPaginator::withQueryString()
   */
  withQueryString(): this {
    Object.assign(this.queryValue, currentRequestQuery());

    return this;
  }

  /**
   * Get or set the URL fragment appended to every generated link
   * Laravel: AbstractPaginator::fragment()
   */
  fragment(fragment?: string): this {
    if (fragment !== undefined && fragment !== null) {
      this.fragmentValue = fragment;
    }

    return this;
  }

  /**
   * The extra metadata resource collections merge into paginated responses
   */
  meta(): Record<string, any> {
    return {};
  }

  /**
   * The pagination result as JSON-ready data
   */
  abstract toArray(request?: any): Record<string, any>;

  /**
   * Serialize the pagination to a JSON string
   * Laravel: AbstractPaginator::toJson()
   */
  toJson(spacing: number | string = 0): string {
    return JSON.stringify(this.toArray(), null, spacing);
  }

  /**
   * JSON.stringify hooks into this, so a paginator embedded in an object
   * graph serialises through toArray()
   */
  toJSON(): Record<string, any> {
    return this.toArray();
  }

  /**
   * Turn prepared query parameters into a link, choosing the separator by
   * whether the path already carries a query string
   */
  protected buildUrl(parameters: Record<string, any>): string {
    const query = UrlGenerator.toQuery(parameters);
    const separator = this.pathValue.includes('?') ? '&' : '?';
    const hash = this.fragmentValue === '' ? '' : `#${this.fragmentValue}`;

    if (query === '') {
      return `${this.pathValue}${hash}`;
    }

    return `${this.pathValue}${separator}${query}${hash}`;
  }

  /**
   * Plain-array items serialise the way the model collections do: through
   * their `toObject()` when they have one
   */
  protected serializeItems(): Record<string, any>[] {
    return this.itemsValue.all().map((item) => serializePaginatedItem(item));
  }
}

/**
 * Convert one paginated row into plain JSON data, leaving values that are
 * already plain untouched.
 */
export function serializePaginatedItem(item: any): any {
  if (item === null || item === undefined) {
    return item;
  }

  if (typeof item.toObject === 'function') {
    return item.toObject();
  }

  if (item instanceof Collection) {
    return item.toArray();
  }

  if (typeof item.toJSON === 'function') {
    return item.toJSON();
  }

  return item;
}
