/**
 * Cursor pagination tests
 *
 * Cursors encode a point in the ordered result instead of a page number, so
 * these pin the encode/decode round trip, the next/previous link pair built
 * from the page's edge items, and the invalid-cursor failure.
 */

import { describe, it, expect } from 'vitest';
import { Cursor, InvalidCursorException } from '@/Pagination/Cursor';
import { CursorPaginator } from '@/Pagination/CursorPaginator';

describe('Cursor', () => {
  it('round-trips through the encoded form', () => {
    const cursor = new Cursor({ created_at: '2026-01-02', id: 7 }, { created_at: 'asc', id: 'asc' });

    const decoded = Cursor.fromEncoded(cursor.toEncoded());

    expect(decoded.parameters).toEqual({ created_at: '2026-01-02', id: 7 });
    expect(decoded.index).toEqual({ created_at: 'asc', id: 'asc' });
    expect(decoded.isBackward()).toBe(false);
  });

  it('keeps the travel option through the encoding', () => {
    const cursor = new Cursor({ id: 3 }, { id: 'asc' }, { travel: 'back' });

    expect(cursor.isBackward()).toBe(true);

    const decoded = Cursor.decode(cursor.encode());
    expect(decoded.isBackward()).toBe(true);

    expect(decoded.reversed().isBackward()).toBe(false);
  });

  it('refuses garbage as an invalid cursor', () => {
    expect(() => Cursor.fromEncoded('not-a-cursor')).toThrow(InvalidCursorException);
    expect(() => Cursor.fromEncoded(Buffer.from('{"nope":true}').toString('base64url'))).toThrow(
      InvalidCursorException
    );
  });
});

describe('CursorPaginator', () => {
  const index = { id: 'asc' } as const;

  function makePaginator(cursor: Cursor | null = null, hasMore: boolean = true, hasPrevious: boolean = false) {
    return new CursorPaginator([{ id: 2 }, { id: 3 }], 2, cursor, {
      path: '/posts',
      query: { filter: 'active' },
      index: { ...index },
      hasMore,
      hasPrevious,
    });
  }

  it('builds the next cursor from the last item of the page', () => {
    const paginator = makePaginator();
    const next = paginator.nextCursor();

    expect(next).not.toBeNull();
    expect(next?.parameters).toEqual({ id: 3 });
    expect(next?.isBackward()).toBe(false);
    expect(paginator.nextPageUrl()).toBe(`/posts?filter=active&cursor=${next?.toEncoded()}`);
  });

  it('has no previous cursor on the first page', () => {
    const paginator = makePaginator();

    expect(paginator.previousCursor()).toBeNull();
    expect(paginator.previousPageUrl()).toBeNull();
    expect(paginator.onFirstPage()).toBe(true);
  });

  it('builds the previous cursor from the first item, travelling back', () => {
    const incoming = new Cursor({ id: 1 }, { ...index });
    const paginator = makePaginator(incoming, true, true);
    const previous = paginator.previousCursor();

    expect(previous?.parameters).toEqual({ id: 2 });
    expect(previous?.isBackward()).toBe(true);
    expect(paginator.previousPageUrl()).toBe(`/posts?filter=active&cursor=${previous?.toEncoded()}`);
  });

  it('ends the links where the data ends', () => {
    const paginator = makePaginator(new Cursor({ id: 1 }, { ...index }), false, true);

    expect(paginator.nextCursor()).toBeNull();
    expect(paginator.nextPageUrl()).toBeNull();
    expect(paginator.hasMorePages()).toBe(false);
  });

  it('leaves the cursor out of the first-page link', () => {
    const paginator = makePaginator();

    expect(paginator.links().first).toBe('/posts?filter=active');
  });

  it('points the last link at the end of the result', () => {
    const paginator = makePaginator();
    const links = paginator.links();

    expect(links.last).toBe(`/posts?filter=active&cursor=${paginator.lastCursor()?.toEncoded()}`);
    expect(links.prev).toBeNull();
    expect(links.next).toBe(paginator.nextPageUrl());
  });

  it('exposes the JSON shape with cursor links and meta', () => {
    const paginator = makePaginator(null, true, false);
    const array = paginator.toArray();

    expect(array.data).toEqual([{ id: 2 }, { id: 3 }]);
    expect(array.path).toBe('/posts');
    expect(array.per_page).toBe(2);
    expect(Object.keys(array.links).sort()).toEqual(['first', 'last', 'next', 'prev']);

    expect(paginator.meta()).toEqual({
      next_cursor: paginator.nextCursor()?.toEncoded() ?? null,
      prev_cursor: null,
    });
  });

  it('serialises models through toObject()', () => {
    const model = { toObject: () => ({ id: 4 }) };
    const paginator = new CursorPaginator([model] as any, 1, null, { path: '/p', index: { id: 'asc' } });

    expect(paginator.toArray().data).toEqual([{ id: 4 }]);
  });

  it('drops the cursor entirely when an ordered column has no value', () => {
    const paginator = new CursorPaginator([{ other: 1 }], 2, null, { path: '/p', index: { id: 'asc' }, hasMore: true });

    expect(paginator.nextCursor()).toBeNull();
    expect(paginator.nextPageUrl()).toBeNull();
  });
});
