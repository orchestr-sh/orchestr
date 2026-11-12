/**
 * UrlWindow
 *
 * Decides which page numbers a length-aware pagination control shows and
 * where it elides, mirroring Illuminate\Pagination\UrlWindow. The window
 * slides around the current page, pinning the first and last page so a long
 * list never renders a hundred links.
 */

import type { LengthAwarePaginator } from './LengthAwarePaginator';

/**
 * A page number inside the window, or null where an ellipsis is shown
 */
export type WindowPage = number | null;

export class UrlWindow {
  /**
   * The pages shown on either side of the current page
   */
  private window: number;

  constructor(
    private paginator: LengthAwarePaginator<any>,
    window: number = 3
  ) {
    this.window = window;
  }

  /**
   * The windowed page numbers: `null` marks a spacer.
   * Laravel: UrlWindow::window()
   */
  get(): WindowPage[] {
    const last = this.paginator.lastPage;
    const current = this.paginator.currentPage;

    if (last <= 3 + 2 * this.window) {
      return this.range(1, last);
    }

    if (current <= 1 + this.window) {
      return [...this.range(1, 2 + this.window), null, last];
    }

    if (current >= last - this.window) {
      return [1, null, ...this.range(last - 1 - this.window, last)];
    }

    return [1, null, ...this.range(current - this.window, current + this.window), null, last];
  }

  /**
   * The URLs of the window, `null` standing where a spacer is shown and
   * `false` marking a page outside the result
   */
  urls(): (string | false | null)[] {
    return this.get().map((page) => (page === null ? null : this.getUrl(page)));
  }

  /**
   * The link of one page, or false when the number lies outside the pages
   * Laravel: UrlWindow::getUrl()
   */
  getUrl(page: number): string | false {
    if (page <= 0 || page > this.paginator.lastPage) {
      return false;
    }

    return this.paginator.url(page);
  }

  /**
   * Inclusive integer range
   */
  private range(start: number, end: number): WindowPage[] {
    const pages: WindowPage[] = [];

    for (let page = Math.max(start, 1); page <= end; page++) {
      pages.push(page);
    }

    return pages;
  }
}
