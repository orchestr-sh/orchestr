/**
 * Paginator
 *
 * The simple pagination object: it only knows whether another page follows -
 * one extra row answers that - so it carries previous/next links instead of
 * page numbers.
 * Illuminate\Pagination\Paginator
 */

import { Collection } from '@/Support/Collection';
import { AbstractPaginator, type PaginationLink, type PaginationOptions } from './AbstractPaginator';

export class Paginator<T = any> extends AbstractPaginator<T> {
  /**
   * Whether the page behind this one holds more rows
   */
  private hasMoreValue: boolean;

  /**
   * Takes the rows a `limit(perPage + 1)` query returned: the extra row is
   * consumed by the has-more check and never shown
   */
  constructor(items: Collection<T> | T[], perPage: number, currentPage: number = 1, options: PaginationOptions = {}) {
    const all = items instanceof Collection ? items : new Collection<T>(items as T[]);
    const hasMore = all.count() > perPage;

    super(hasMore ? all.take(perPage) : all, perPage, currentPage, options);

    this.hasMoreValue = hasMore;
  }

  /**
   * Determine whether more pages exist after this one
   */
  hasMorePages(): boolean {
    return this.hasMoreValue;
  }

  /**
   * The URL of the next page, or null when this one ended short
   */
  nextPageUrl(): string | null {
    if (!this.hasMoreValue) {
      return null;
    }

    return this.url(this.currentPageValue + 1);
  }

  /**
   * The previous/next link pair of a simple pagination
   */
  links(): PaginationLink[] {
    return [
      { url: this.previousPageUrl(), label: '&laquo; Previous', active: false },
      { url: this.nextPageUrl(), label: 'Next &raquo;', active: false },
    ];
  }

  /**
   * The simple pagination as JSON data: no totals, no page numbers
   * Laravel: Paginator::toArray()
   */
  toArray(): Record<string, any> {
    return {
      current_page: this.currentPageValue,
      data: this.serializeItems(),
      first_page_url: this.url(1),
      from: this.firstItem(),
      next_page_url: this.nextPageUrl(),
      path: this.pathValue,
      per_page: this.perPageValue,
      prev_page_url: this.previousPageUrl(),
      to: this.lastItem(),
    };
  }
}
