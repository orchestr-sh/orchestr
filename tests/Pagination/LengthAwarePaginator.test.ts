/**
 * LengthAware pagination tests
 *
 * The paginator owns its metadata, so these pin the JSON Laravel spells:
 * totals, page window, link labels, and the query-string preservation that
 * every generated URL shares through UrlGenerator::toQuery().
 */

import { describe, it, expect, afterEach } from 'vitest';
import { LengthAwarePaginator } from '@/Pagination/LengthAwarePaginator';
import { resolveCurrentRequestUsing } from '@/Pagination/PaginationContext';
import { UrlWindow } from '@/Pagination/UrlWindow';
import { Collection } from '@/Support/Collection';

afterEach(() => {
  resolveCurrentRequestUsing(null);
});

function page(
  items: Record<string, any>[],
  total: number,
  perPage: number = 15,
  currentPage: number = 1,
  options = {}
) {
  return new LengthAwarePaginator(items, total, perPage, currentPage, options);
}

describe('LengthAwarePaginator', () => {
  it('exposes the metadata Laravel spells in the JSON response', () => {
    const rows = [{ id: 1 }, { id: 2 }];
    const paginator = page(rows, 47, 15, 2, { path: '/posts' });

    expect(paginator.total).toBe(47);
    expect(paginator.perPage).toBe(15);
    expect(paginator.currentPage).toBe(2);
    expect(paginator.lastPage).toBe(4);
    expect(paginator.from).toBe(16);
    expect(paginator.to).toBe(17);
    expect(paginator.data).toEqual(rows);
    expect(paginator.items).toBeInstanceOf(Collection);
  });

  it('serialises models through their own toObject()', () => {
    const model = { toObject: () => ({ id: 1, title: 'Hello' }) };
    const paginator = page([model] as any, 1);

    expect(paginator.toArray().data).toEqual([{ id: 1, title: 'Hello' }]);
  });

  it('builds the full toArray() shape', () => {
    const paginator = page([{ id: 1 }, { id: 2 }], 2, 2, 1, { path: '/posts' });
    const array = paginator.toArray();

    expect(array.current_page).toBe(1);
    expect(array.data).toEqual([{ id: 1 }, { id: 2 }]);
    expect(array.first_page_url).toBe('/posts?page=1');
    expect(array.from).toBe(1);
    expect(array.last_page).toBe(1);
    expect(array.last_page_url).toBe('/posts?page=1');
    expect(array.next_page_url).toBeNull();
    expect(array.prev_page_url).toBeNull();
    expect(array.path).toBe('/posts');
    expect(array.per_page).toBe(2);
    expect(array.to).toBe(2);
    expect(array.total).toBe(2);
  });

  it('keeps existing query string parameters in generated URLs', () => {
    const paginator = page([], 100, 10, 3, { path: '/posts', query: { filter: 'active', sort: 'title' } });

    expect(paginator.url(4)).toBe('/posts?filter=active&sort=title&page=4');
    expect(paginator.nextPageUrl()).toBe('/posts?filter=active&sort=title&page=4');
    expect(paginator.previousPageUrl()).toBe('/posts?filter=active&sort=title&page=2');
  });

  it('lets the page parameter override a stale page in the preserved query', () => {
    const paginator = page([], 100, 10, 3, { path: '/posts', query: { page: '99', filter: 'x' } });

    // The stale page keeps its slot but carries the real value
    expect(paginator.url(3)).toBe('/posts?page=3&filter=x');
  });

  it('reads path and query from the current request when none are given', () => {
    resolveCurrentRequestUsing(() => ({ path: '/posts', query: { search: 'laravel' } }));

    const paginator = page([], 100, 10, 2);

    expect(paginator.toArray().path).toBe('/posts');
    expect(paginator.nextPageUrl()).toBe('/posts?search=laravel&page=3');
  });

  it('re-reads the request query with withQueryString()', () => {
    resolveCurrentRequestUsing(() => ({ path: '/posts', query: { a: '1' } }));
    const paginator = page([], 5, 2, 2, { path: '/posts' });

    // The snapshot taken at construction keeps the old parameters...
    expect(paginator.url(3)).toBe('/posts?a=1&page=3');

    // ...while withQueryString() pulls whatever the request carries now
    resolveCurrentRequestUsing(() => ({ path: '/posts', query: { a: '1', b: '2' } }));
    paginator.withQueryString();

    expect(paginator.url(3)).toBe('/posts?a=1&b=2&page=3');
  });

  it('appends parameters onto every link', () => {
    const paginator = page([], 30, 10, 2, { path: '/posts' });

    paginator.appends('order', 'desc').appends({ direction: 'asc' });

    expect(paginator.url(3)).toBe('/posts?order=desc&direction=asc&page=3');
  });

  it('fragments the links', () => {
    const paginator = page([], 30, 10, 1, { path: '/posts', fragment: 'list' });

    expect(paginator.url(2)).toBe('/posts?page=2#list');
    expect(paginator.nextPageUrl()).toBe('/posts?page=2#list');

    paginator.fragment('other');
    expect(paginator.url(2)).toBe('/posts?page=2#other');
  });

  it('handles paths that already carry a query string', () => {
    const paginator = page([], 30, 10, 1, { path: '/posts?tab=all' });

    expect(paginator.url(2)).toBe('/posts?tab=all&page=2');
  });

  it('knows the first and last pages', () => {
    const first = page([], 30, 10, 1);
    const last = page([], 30, 10, 3);

    expect(first.onFirstPage()).toBe(true);
    expect(first.onLastPage()).toBe(false);
    expect(first.previousPageUrl()).toBeNull();
    expect(first.hasMorePages()).toBe(true);
    expect(first.hasPages()).toBe(true);

    expect(last.onFirstPage()).toBe(false);
    expect(last.onLastPage()).toBe(true);
    expect(last.nextPageUrl()).toBeNull();
    expect(last.hasMorePages()).toBe(false);
  });

  it('reports an empty result without a page window', () => {
    const paginator = page([], 0, 15, 1, { path: '/posts' });

    expect(paginator.lastPage).toBe(1);
    expect(paginator.from).toBeNull();
    expect(paginator.to).toBeNull();
    expect(paginator.isEmpty()).toBe(true);
    expect(paginator.hasPages()).toBe(false);
    expect(paginator.nextPageUrl()).toBeNull();
  });

  it('renders windowed links with spacers for long results', () => {
    const paginator = page([], 1000, 10, 50, { path: '/p' });
    const links = paginator.links();

    const labels = links.map((link) => link.label);
    expect(labels).toEqual([
      '&laquo; Previous',
      '1',
      '…',
      '47',
      '48',
      '49',
      '50',
      '51',
      '52',
      '53',
      '…',
      '100',
      'Next &raquo;',
    ]);

    const active = links.filter((link) => link.active);
    expect(active).toHaveLength(1);
    expect(active[0].label).toBe('50');
    expect(active[0].url).toBe('/p?page=50');

    expect(links[0].url).toBe('/p?page=49');
    expect(links[links.length - 1].url).toBe('/p?page=51');
    expect(links[2].url).toBeNull();
  });

  it('shows every page when the window covers them all', () => {
    const paginator = page([], 50, 10, 3, { path: '/p' });
    const numeric = paginator
      .links()
      .filter((link) => link.label !== '&laquo; Previous' && link.label !== 'Next &raquo;');

    expect(numeric.map((link) => link.label)).toEqual(['1', '2', '3', '4', '5']);
  });

  it('exposes the pagination metadata resource collections merge', () => {
    const paginator = page([], 47, 15, 2, { path: '/posts' });

    expect(paginator.meta()).toEqual({
      total: 47,
      per_page: 15,
      last_page: 4,
      next_page_url: '/posts?page=3',
      prev_page_url: '/posts?page=1',
    });
  });

  it('serialises to JSON', () => {
    const paginator = page([{ id: 1 }], 1, 15, 1, { path: '/posts' });

    expect(JSON.parse(paginator.toJson()).total).toBe(1);
    expect(JSON.parse(JSON.stringify({ page: paginator })).page.data).toEqual([{ id: 1 }]);
  });
});

describe('UrlWindow', () => {
  it('slides the window around the current page and pins the ends', () => {
    const paginator = page([], 1000, 10, 50, { path: '/p' });
    const window = new UrlWindow(paginator, 2);

    expect(window.get()).toEqual([1, null, 48, 49, 50, 51, 52, null, 100]);
  });

  it('starts pinned at the front', () => {
    const paginator = page([], 1000, 10, 2, { path: '/p' });

    expect(new UrlWindow(paginator, 2).get()).toEqual([1, 2, 3, 4, null, 100]);
  });

  it('ends pinned at the back', () => {
    const paginator = page([], 1000, 10, 99, { path: '/p' });

    expect(new UrlWindow(paginator, 2).get()).toEqual([1, null, 97, 98, 99, 100]);
  });

  it('shows everything for short results', () => {
    const paginator = page([], 50, 10, 1, { path: '/p' });

    expect(new UrlWindow(paginator, 3).get()).toEqual([1, 2, 3, 4, 5]);
  });

  it('maps the window to URLs and rejects out-of-range pages', () => {
    const paginator = page([], 100, 10, 5, { path: '/p' });
    const window = new UrlWindow(paginator, 1);

    expect(window.urls()).toEqual(['/p?page=1', null, '/p?page=4', '/p?page=5', '/p?page=6', null, '/p?page=10']);
    expect(window.getUrl(0)).toBe(false);
    expect(window.getUrl(11)).toBe(false);
  });
});
