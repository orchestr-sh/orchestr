/**
 * Ensemble pagination builder tests
 *
 * The builder owns running the query: these pin that paginate/simplePaginate/
 * cursorPaginate reuse the where, order, eager-load and scope state the caller
 * built, take totals through the same aggregate path as `count()`, and hand
 * the rows plus metadata to the pagination objects.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseManager } from '@/Database/DatabaseManager';
import { Ensemble } from '@/Database/Ensemble/Ensemble';
import { EnsembleBuilder } from '@/Database/Ensemble/EnsembleBuilder';
import { Cursor, InvalidCursorException } from '@/Pagination/Cursor';
import { CursorPaginator } from '@/Pagination/CursorPaginator';
import { LengthAwarePaginator } from '@/Pagination/LengthAwarePaginator';
import { resolveCurrentRequestUsing } from '@/Pagination/PaginationContext';
import { Paginator } from '@/Pagination/Paginator';
import { recordAdapter, type ExecutedQuery } from '../Database/Query/support';

// ---------------------------------------------------------------------------
// Recording helpers (same seam the relationship-query suite uses)
// ---------------------------------------------------------------------------

function useSelectQueue(queues: any[][]): ExecutedQuery[] {
  const { adapter, queries } = recordAdapter();
  const remaining = [...queues];

  vi.mocked(adapter.select).mockImplementation(async (sql: string, bindings: any[] = []) => {
    queries.push({ method: 'select', sql, bindings });
    return remaining.shift() ?? [];
  });

  const manager = new DatabaseManager({
    default: 'test',
    connections: {
      test: { adapter: 'recording', driver: 'sqlite', database: ':memory:' },
    },
  });
  manager.registerAdapter('recording', () => adapter);
  Ensemble.setConnectionResolver(manager);

  return queries;
}

// ---------------------------------------------------------------------------
// Test models
// ---------------------------------------------------------------------------

class Post extends Ensemble {
  static softDeletes = true;
  static fillable: string[] = ['title', 'created_at'];

  getTable(): string {
    return 'posts';
  }

  comments() {
    return this.hasMany(Comment, 'post_id');
  }
}

class Comment extends Ensemble {
  static fillable: string[] = ['post_id', 'body'];

  getTable(): string {
    return 'comments';
  }
}

class Tenant extends Ensemble {
  static fillable: string[] = ['name'];

  getTable(): string {
    return 'tenants';
  }
}

Tenant.addGlobalScope('active', (builder: EnsembleBuilder<any>) => builder.where('active', '=', 1));

beforeEach(() => {
  resolveCurrentRequestUsing(null);
});

afterEach(() => {
  resolveCurrentRequestUsing(null);
});

describe('EnsembleBuilder::paginate', () => {
  it('returns a length-aware paginator with correct metadata', async () => {
    useSelectQueue([
      [{ aggregate: 47 }],
      [
        { id: 1, title: 'First' },
        { id: 2, title: 'Second' },
      ],
    ]);

    const page = await Post.query().paginate(15, 2, ['*'], { path: '/posts' });

    expect(page).toBeInstanceOf(LengthAwarePaginator);
    expect(page.total).toBe(47);
    expect(page.lastPage).toBe(4);
    expect(page.currentPage).toBe(2);
    expect(page.from).toBe(16);
    expect(page.to).toBe(17);
    expect(page.data).toHaveLength(2);

    const array = page.toArray();
    expect(array.data).toHaveLength(2);
    expect(array.total).toBe(47);
    expect(array.last_page).toBe(4);
    expect(array.from).toBe(16);
    expect(array.to).toBe(17);
    expect(array.next_page_url).toBe('/posts?page=3');
    expect(array.prev_page_url).toBe('/posts?page=1');
    expect(array.links).toHaveLength(6);
  });

  it('takes the total through the count aggregate and the page through limit/offset', async () => {
    const queries = useSelectQueue([[{ aggregate: 3 }], [{ id: 1 }, { id: 2 }]]);

    await Post.query().where('published', '=', 1).orderBy('id', 'desc').paginate(2, 1);

    expect(queries[0].sql).toContain('COUNT(*) as aggregate');
    expect(queries[0].sql).toContain('WHERE "published" = ? AND "posts"."deleted_at" IS NULL');
    expect(queries[0].bindings).toEqual([1]);
    expect(queries[1].sql).toBe(
      'SELECT * FROM "posts" WHERE "published" = ? AND "posts"."deleted_at" IS NULL ORDER BY "id" DESC LIMIT 2 OFFSET 0'
    );
    expect(queries[1].bindings).toEqual([1]);
  });

  it('pagination totals respect global scopes', async () => {
    const queries = useSelectQueue([[{ aggregate: 2 }], [{ id: 1 }, { id: 2 }]]);

    await Tenant.query().paginate(15, 1);

    expect(queries[0].sql).toContain('WHERE "active" = ?');
    expect(queries[0].bindings).toEqual([1]);
    expect(queries[1].sql).toContain('LIMIT 15 OFFSET 0');
  });

  it('skips the page query entirely for an empty result', async () => {
    const queries = useSelectQueue([[{ aggregate: 0 }]]);

    const page = await Post.query().paginate(15, 1);

    expect(page.data).toEqual([]);
    expect(queries).toHaveLength(1);
  });

  it('respects with() eager loads on the paginated page', async () => {
    const queries = useSelectQueue([
      [{ aggregate: 2 }],
      [{ id: 1 }, { id: 2 }],
      [
        { id: 10, post_id: 1, body: 'Hi' },
        { id: 11, post_id: 2, body: 'Yo' },
      ],
    ]);

    const page = await Post.query().with('comments').paginate(15, 1);

    expect(queries).toHaveLength(3);
    expect(page.data[0].getRelation('comments')).toHaveLength(1);
    expect(page.data[0].relationLoaded('comments')).toBe(true);
  });

  it('honours the columns argument', async () => {
    const queries = useSelectQueue([[{ aggregate: 1 }], [{ id: 5 }]]);

    await Post.query().paginate(15, 1, ['id']);

    expect(queries[1].sql).toBe('SELECT "id" FROM "posts" WHERE "posts"."deleted_at" IS NULL LIMIT 15 OFFSET 0');
  });

  it('preserves the current request query string in the links', async () => {
    useSelectQueue([[{ aggregate: 30 }], [{ id: 1 }]]);

    resolveCurrentRequestUsing(() => ({ path: '/posts', query: { filter: 'active', sort: 'title', page: '2' } }));

    const page = await Post.query().paginate(10, 2);

    expect(page.nextPageUrl()).toBe('/posts?filter=active&sort=title&page=3');
    expect(page.previousPageUrl()).toBe('/posts?filter=active&sort=title&page=1');
    expect(page.toArray().first_page_url).toBe('/posts?filter=active&sort=title&page=1');
  });
});

describe('EnsembleBuilder::simplePaginate', () => {
  it('fetches one extra row and reports whether a next page exists', async () => {
    const queries = useSelectQueue([[{ id: 1 }, { id: 2 }, { id: 3 }]]);

    const page = await Post.query().simplePaginate(2, 1, ['*'], { path: '/posts' });

    expect(page).toBeInstanceOf(Paginator);
    expect(queries[0].sql).toBe('SELECT * FROM "posts" WHERE "posts"."deleted_at" IS NULL LIMIT 3 OFFSET 0');
    expect(page.data).toHaveLength(2);
    expect(page.hasMorePages()).toBe(true);
    expect(page.nextPageUrl()).toBe('/posts?page=2');
    expect(page.previousPageUrl()).toBeNull();
  });

  it('has no next page when the extra row is missing', async () => {
    useSelectQueue([[{ id: 1 }]]);

    const page = await Post.query().simplePaginate(2, 1, ['*'], { path: '/posts' });

    expect(page.data).toHaveLength(1);
    expect(page.nextPageUrl()).toBeNull();
    expect(page.onLastPage()).toBe(true);
  });

  it('runs no count query at all', async () => {
    const queries = useSelectQueue([[{ id: 1 }, { id: 2 }]]);

    await Post.query().where('published', '=', 1).simplePaginate(2, 2);

    expect(queries).toHaveLength(1);
    expect(queries[0].sql).not.toContain('COUNT');
    expect(queries[0].sql).toContain('OFFSET 2');
  });

  it('keeps eager loads running on the page', async () => {
    const queries = useSelectQueue([[{ id: 1 }, { id: 2 }, { id: 3 }], [{ id: 10, post_id: 1, body: 'Hi' }]]);

    const page = await Post.query().with('comments').simplePaginate(2, 1);

    expect(queries).toHaveLength(2);
    expect(page.data[0].relationLoaded('comments')).toBe(true);
  });
});

describe('EnsembleBuilder::cursorPaginate', () => {
  it('fetches one row ahead and hands the next page a cursor', async () => {
    const queries = useSelectQueue([
      [
        { id: 1, created_at: '2026-01-01' },
        { id: 2, created_at: '2026-01-02' },
        { id: 3, created_at: '2026-01-03' },
      ],
    ]);

    const page = await Post.query().orderBy('id', 'asc').cursorPaginate(2, null, ['*'], { path: '/posts' });

    expect(page).toBeInstanceOf(CursorPaginator);
    expect(page.data).toHaveLength(2);
    expect(queries[0].sql).toBe('SELECT * FROM "posts" WHERE "posts"."deleted_at" IS NULL ORDER BY "id" ASC LIMIT 3');

    const next = page.nextCursor();
    expect(next?.parameters).toEqual({ id: 2 });
    expect(page.previousCursor()).toBeNull();
    expect(page.nextPageUrl()).toBe(`/posts?cursor=${next?.toEncoded()}`);
  });

  it('constrains later pages with a tie-aware OR window', async () => {
    const queries = useSelectQueue([
      [
        { id: 4, created_at: '2026-01-04' },
        { id: 5, created_at: '2026-01-05' },
      ],
    ]);

    const cursor = new Cursor({ created_at: '2026-01-03', id: 3 }, { created_at: 'desc', id: 'asc' });
    const page = await Post.query().orderBy('created_at', 'desc').orderBy('id', 'asc').cursorPaginate(2, cursor);

    expect(queries[0].sql).toBe(
      'SELECT * FROM "posts" WHERE "posts"."deleted_at" IS NULL AND (("created_at" < ?) OR ("created_at" = ? AND "id" > ?)) ' +
        'ORDER BY "created_at" DESC, "id" ASC LIMIT 3'
    );
    expect(queries[0].bindings).toEqual(['2026-01-03', '2026-01-03', 3]);
    expect(page.previousCursor()?.isBackward()).toBe(true);
  });

  it('accepts the encoded cursor straight from a query string', async () => {
    useSelectQueue([[{ id: 4 }, { id: 5 }]]);

    const encoded = new Cursor({ id: 3 }, { id: 'asc' }).toEncoded();
    const page = await Post.query().orderBy('id').cursorPaginate(2, encoded);

    expect(page.cursor()?.parameters).toEqual({ id: 3 });
  });

  it('walks backwards: reversed order, flipped comparisons, forward page', async () => {
    // Fetched in reverse: [3, 2, 1] with 1 the extra row beyond the page;
    // flipping back and dropping it leaves [2, 3]
    const queries = useSelectQueue([[{ id: 3 }, { id: 2 }, { id: 1 }]]);

    const back = new Cursor({ id: 4 }, { id: 'asc' }, { travel: 'back' });
    const page = await Post.query().orderBy('id', 'asc').cursorPaginate(2, back);

    expect(queries[0].sql).toBe(
      'SELECT * FROM "posts" WHERE "posts"."deleted_at" IS NULL AND ("id" < ?) ORDER BY "id" DESC LIMIT 3'
    );
    expect(queries[0].bindings).toEqual([4]);
    expect(page.data.map((post: any) => post.getKey())).toEqual([2, 3]);
    expect(page.previousCursor()?.parameters).toEqual({ id: 2 });
    expect(page.nextCursor()?.parameters).toEqual({ id: 3 });
  });

  it('lands on the first page when the backwards walk runs out', async () => {
    useSelectQueue([[{ id: 2 }, { id: 1 }]]);

    const back = new Cursor({ id: 3 }, { id: 'asc' }, { travel: 'back' });
    const page = await Post.query().orderBy('id', 'asc').cursorPaginate(2, back);

    expect(page.data.map((post: any) => post.getKey())).toEqual([1, 2]);
    expect(page.previousCursor()).toBeNull();
    expect(page.onFirstPage()).toBe(true);
    expect(page.nextCursor()?.parameters).toEqual({ id: 2 });
  });

  it('falls back to ordering by the primary key', async () => {
    const queries = useSelectQueue([[{ id: 1 }]]);

    const page = await Post.query().cursorPaginate(2);

    expect(queries[0].sql).toContain('ORDER BY "id" ASC');
    expect(page.toArray().data).toEqual([{ id: 1 }]);
  });

  it('keeps eager loads and existing wheres on cursor pages', async () => {
    const queries = useSelectQueue([[{ id: 1, created_at: '2026-01-01' }], [{ id: 10, post_id: 1, body: 'Hi' }]]);

    const page = await Post.query().where('published', '=', 1).orderBy('id').with('comments').cursorPaginate(2);

    expect(queries[0].sql).toContain('WHERE "published" = ? AND "posts"."deleted_at" IS NULL');
    expect(queries).toHaveLength(2);
    expect(page.data[0].relationLoaded('comments')).toBe(true);
  });

  it('rejects a malformed cursor', async () => {
    useSelectQueue([]);

    await expect(Post.query().cursorPaginate(2, 'not-a-cursor')).rejects.toThrow(InvalidCursorException);
  });

  it('rejects a cursor missing an ordered column', async () => {
    useSelectQueue([]);

    const cursor = new Cursor({ other: 1 }, { id: 'asc' });

    await expect(Post.query().orderBy('id').cursorPaginate(2, cursor)).rejects.toThrow(InvalidCursorException);
  });
});
