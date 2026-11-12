/**
 * Simple pagination tests
 *
 * The `Paginator` decides "is there a next page" from the extra row a
 * `limit(perPage + 1)` query hands back, so these pin the slicing, the
 * absence of totals, and the previous/next link pair.
 */

import { describe, it, expect } from 'vitest';
import { Paginator } from '@/Pagination/Paginator';

describe('Paginator', () => {
  it('consumes the extra row as the has-more signal and drops it from the page', () => {
    const rows = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const paginator = new Paginator(rows, 2, 1, { path: '/posts' });

    expect(paginator.data).toEqual([{ id: 1 }, { id: 2 }]);
    expect(paginator.count()).toBe(2);
    expect(paginator.hasMorePages()).toBe(true);
    expect(paginator.nextPageUrl()).toBe('/posts?page=2');
  });

  it('reports no next page when the query came back short', () => {
    const paginator = new Paginator([{ id: 1 }], 2, 1, { path: '/posts' });

    expect(paginator.data).toHaveLength(1);
    expect(paginator.hasMorePages()).toBe(false);
    expect(paginator.onLastPage()).toBe(true);
    expect(paginator.nextPageUrl()).toBeNull();
  });

  it('links backwards from pages after the first', () => {
    const paginator = new Paginator([], 2, 3, { path: '/posts', query: { filter: 'active' } });

    expect(paginator.previousPageUrl()).toBe('/posts?filter=active&page=2');
    expect(paginator.onFirstPage()).toBe(false);
  });

  it('has no first page on the first page', () => {
    const paginator = new Paginator([], 2, 1, { path: '/posts' });

    expect(paginator.previousPageUrl()).toBeNull();
    expect(paginator.onFirstPage()).toBe(true);
  });

  it('exposes the simple toArray shape without totals', () => {
    const paginator = new Paginator([{ id: 1 }, { id: 2 }, { id: 3 }], 2, 1, { path: '/posts' });
    const array = paginator.toArray();

    expect(array.current_page).toBe(1);
    expect(array.data).toEqual([{ id: 1 }, { id: 2 }]);
    expect(array.first_page_url).toBe('/posts?page=1');
    expect(array.from).toBe(1);
    expect(array.to).toBe(2);
    expect(array.next_page_url).toBe('/posts?page=2');
    expect(array.prev_page_url).toBeNull();
    expect(array.path).toBe('/posts');
    expect(array.per_page).toBe(2);
    expect(array).not.toHaveProperty('total');
    expect(array).not.toHaveProperty('last_page');
  });

  it('renders the previous/next link pair', () => {
    const paginator = new Paginator([{ id: 1 }, { id: 2 }], 2, 2, { path: '/p' });

    expect(paginator.links()).toEqual([
      { url: '/p?page=1', label: '&laquo; Previous', active: false },
      { url: null, label: 'Next &raquo;', active: false },
    ]);
  });

  it('serialises to JSON through toArray()', () => {
    const paginator = new Paginator([{ id: 1 }], 1, 1);

    expect(JSON.parse(paginator.toJson()).current_page).toBe(1);
    expect(JSON.parse(JSON.stringify(paginator)).data).toEqual([{ id: 1 }]);
  });
});
