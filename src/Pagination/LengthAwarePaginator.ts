/**
 * LengthAwarePaginator
 *
 * The full pagination object: it knows the total row count, so it can answer
 * "how many pages are there" and render the windowed link list Laravel puts
 * in `meta.links`.
 * Illuminate\Pagination\LengthAwarePaginator
 */

import type { Collection } from '@/Support/Collection';
import { AbstractPaginator, type PaginationLink, type PaginationOptions } from './AbstractPaginator';
import { UrlWindow } from './UrlWindow';

export interface LengthAwareOptions extends PaginationOptions {
  /**
   * How many page links to show on each side of the current page
   */
  onEachSide?: number;
}

export class LengthAwarePaginator<T = any> extends AbstractPaginator<T> {
  /**
   * The total number of rows behind every page
   */
  private totalValue: number;

  /**
   * The width of the sliding link window
   */
  private onEachSideValue: number;

  constructor(
    items: Collection<T> | T[],
    total: number,
    perPage: number,
    currentPage: number = 1,
    options: LengthAwareOptions = {}
  ) {
    super(items, perPage, currentPage, options);

    this.totalValue = total;
    this.onEachSideValue = options.onEachSide ?? 3;
  }

  /**
   * The total number of rows across every page
   */
  get total(): number {
    return this.totalValue;
  }

  /**
   * The number of the final page (at least one, even for an empty result)
   * Laravel: LengthAwarePaginator::lastPage()
   */
  get lastPage(): number {
    return Math.max(Math.ceil(this.totalValue / this.perPageValue), 1);
  }

  /**
   * The first item's position, or null while the result set is empty
   */
  firstItem(): number | null {
    if (this.totalValue === 0) {
      return null;
    }

    return super.firstItem();
  }

  /**
   * The URL one page ahead, or null on the last page
   */
  nextPageUrl(): string | null {
    if (!this.hasMorePages()) {
      return null;
    }

    return this.url(this.currentPageValue + 1);
  }

  /**
   * Determine whether more pages exist after this one
   */
  hasMorePages(): boolean {
    return this.currentPageValue < this.lastPage;
  }

  /**
   * Determine whether there is more than one page to move between
   * Laravel: LengthAwarePaginator::hasPages()
   */
  hasPages(): boolean {
    return this.lastPage > 1;
  }

  /**
   * The windowed link list: previous, page numbers with spacers, next
   * Laravel: the `links` entries of LengthAwarePaginator::toArray()
   */
  links(): PaginationLink[] {
    const window = new UrlWindow(this, this.onEachSideValue);
    const links: PaginationLink[] = [{ url: this.previousPageUrl(), label: '&laquo; Previous', active: false }];

    for (const page of window.get()) {
      if (page === null) {
        links.push({ url: null, label: '…', active: false });
        continue;
      }

      links.push({ url: this.url(page), label: String(page), active: page === this.currentPageValue });
    }

    links.push({ url: this.nextPageUrl(), label: 'Next &raquo;', active: false });

    return links;
  }

  /**
   * The metadata resource collections merge into a paginated response
   * Laravel: LengthAwarePaginator::meta()
   */
  meta(): Record<string, any> {
    return {
      total: this.totalValue,
      per_page: this.perPageValue,
      last_page: this.lastPage,
      next_page_url: this.nextPageUrl(),
      prev_page_url: this.previousPageUrl(),
    };
  }

  /**
   * The pagination as Laravel's JSON shape: data plus the full meta list
   * Laravel: LengthAwarePaginator::toArray()
   */
  toArray(): Record<string, any> {
    return {
      current_page: this.currentPageValue,
      data: this.serializeItems(),
      first_page_url: this.url(1),
      from: this.firstItem(),
      last_page: this.lastPage,
      last_page_url: this.url(this.lastPage),
      links: this.links(),
      next_page_url: this.nextPageUrl(),
      path: this.pathValue,
      per_page: this.perPageValue,
      prev_page_url: this.previousPageUrl(),
      to: this.lastItem(),
      total: this.totalValue,
    };
  }
}
