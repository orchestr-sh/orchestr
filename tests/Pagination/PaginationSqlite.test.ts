/**
 * Pagination against a real SQLite database
 *
 * The unit suites pin the compiled statements; this one proves the behaviour
 * the ticket promises end to end: pages contain exactly the right rows, totals
 * exclude soft-deleted ones, cursors walk forward and back without gaps or
 * repeats, eager loads still fire, and a resource collection over a paginator
 * writes the wrapped JSON with its pagination meta.
 *
 * better-sqlite3 is an optional dependency (and needs a native build), so the
 * integration suite only runs when the driver is actually installed.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Cursor } from '@/Pagination/Cursor';
import { DrizzleAdapter } from '@/Database/Adapters/DrizzleAdapter';
import { DatabaseManager } from '@/Database/DatabaseManager';
import { Ensemble } from '@/Database/Ensemble/Ensemble';
// The resources index loads the whole module graph, which registers the
// collection factory `JsonResource.collection()` runs through
import { JsonResource } from '@/Http/Resources';
import { resolveCurrentRequestUsing } from '@/Pagination/PaginationContext';

async function hasBetterSqlite(): Promise<boolean> {
  try {
    const Database = await import('better-sqlite3');
    const db = new Database.default(':memory:');
    db.close();
    return true;
  } catch {
    return false;
  }
}

const WITH_BETTER_SQLITE = await hasBetterSqlite();

const SCHEMA = `
  CREATE TABLE posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    body TEXT,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT
  );
  CREATE TABLE comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER,
    body TEXT,
    created_at TEXT,
    updated_at TEXT
  );
`;

class Comment extends Ensemble {
  static fillable: string[] = ['post_id', 'body'];

  getTable(): string {
    return 'comments';
  }
}

class Post extends Ensemble {
  static softDeletes = true;
  static fillable: string[] = ['title', 'body'];

  getTable(): string {
    return 'posts';
  }

  comments() {
    return this.hasMany(Comment, 'post_id');
  }
}

class PostResource extends JsonResource {
  toArray(): Record<string, any> {
    return {
      id: this.resource.getKey(),
      title: this.resource.getAttribute('title'),
      comments: this.whenLoaded('comments'),
    };
  }
}

describe.skipIf(!WITH_BETTER_SQLITE)('Ensemble pagination (better-sqlite3)', () => {
  let adapter: DrizzleAdapter;

  beforeEach(async () => {
    resolveCurrentRequestUsing(null);

    adapter = new DrizzleAdapter({ driver: 'better-sqlite3', database: ':memory:' });
    await adapter.connect();

    for (const statement of SCHEMA.split(';').filter((s) => s.trim() !== '')) {
      await adapter.query(statement);
    }

    const manager = new DatabaseManager({
      default: 'main',
      connections: {
        main: { adapter: 'drizzle', driver: 'better-sqlite3', database: ':memory:' },
      },
    });
    manager.registerAdapter('drizzle', () => adapter);
    Ensemble.setConnectionResolver(manager);
  });

  afterEach(async () => {
    resolveCurrentRequestUsing(null);
    await adapter.disconnect();
  });

  /**
   * Nine live posts (plus one trashed) with distinct created_at stamps and a
   * comment each, so pages have real rows, ordering, and eager loads to check
   */
  async function seed(count = 9): Promise<void> {
    for (let index = 1; index <= count; index++) {
      const post = await Post.create({ title: `Post ${index}`, body: `Body ${index}` });

      await adapter.query(
        `UPDATE posts SET created_at = '${String(index).padStart(2, '0')} 00:00:00' WHERE id = ${post.getKey()}`
      );

      await Comment.create({ post_id: post.getKey(), body: `Comment on ${index}` });
    }
  }

  const titles = (page: { data: Post[] }) => page.data.map((post) => post.getAttribute('title'));

  it('paginate hands back the page, totals, and windowed links', async () => {
    await seed(9);

    const page = await Post.query().orderBy('created_at', 'asc').paginate(4, 2, ['*'], { path: '/posts' });

    expect(page.total).toBe(9);
    expect(page.lastPage).toBe(3);
    expect(page.from).toBe(5);
    expect(page.to).toBe(8);
    expect(titles(page)).toEqual(['Post 5', 'Post 6', 'Post 7', 'Post 8']);
    expect(page.nextPageUrl()).toBe('/posts?page=3');
    expect(page.previousPageUrl()).toBe('/posts?page=1');
    expect(page.links().filter((link) => link.active)).toHaveLength(1);
  });

  it('pagination totals exclude soft-deleted rows', async () => {
    await seed(9);

    const trashed = await Post.query().where('title', '=', 'Post 3').first();
    if (trashed) {
      await trashed.delete();
    }

    const page = await Post.query().orderBy('id', 'asc').paginate(4, 2, ['*'], { path: '/posts' });

    expect(page.total).toBe(8);
    expect(page.lastPage).toBe(2);
    expect(titles(page)).toEqual(['Post 6', 'Post 7', 'Post 8', 'Post 9']);
    expect(page.nextPageUrl()).toBeNull();
  });

  it('runs no page query when the totals come back empty', async () => {
    const page = await Post.query().paginate(4, 1);

    expect(page.total).toBe(0);
    expect(page.data).toEqual([]);
  });

  it('keeps the request query string in generated links', async () => {
    await seed(9);

    resolveCurrentRequestUsing(() => ({ path: '/posts', query: { filter: 'fresh', page: '1' } }));

    const page = await Post.query().paginate(4, 2);

    expect(page.nextPageUrl()).toBe('/posts?filter=fresh&page=3');
    expect(page.toArray().first_page_url).toBe('/posts?filter=fresh&page=1');
  });

  it('eager loads the with() relations onto the page', async () => {
    await seed(3);

    const page = await Post.query().with('comments').orderBy('created_at', 'asc').paginate(2, 1);

    expect(page.data).toHaveLength(2);
    expect(page.data[0].relationLoaded('comments')).toBe(true);
    expect((page.data[0].getRelation('comments') as any).all()[0].getAttribute('body')).toBe('Comment on 1');
  });

  it('simplePaginate slices the extra row into a has-more flag', async () => {
    await seed(5);

    const first = await Post.query().orderBy('id', 'asc').simplePaginate(2, 1, ['*'], { path: '/posts' });
    const second = await Post.query().orderBy('id', 'asc').simplePaginate(2, 2, ['*'], { path: '/posts' });
    const third = await Post.query().orderBy('id', 'asc').simplePaginate(2, 3, ['*'], { path: '/posts' });

    expect(titles(first)).toEqual(['Post 1', 'Post 2']);
    expect(first.hasMorePages()).toBe(true);
    expect(titles(second)).toEqual(['Post 3', 'Post 4']);
    // A fifth row still waits behind page two
    expect(second.hasMorePages()).toBe(true);
    expect(third.data).toHaveLength(1);
    expect(third.hasMorePages()).toBe(false);
  });

  it('cursorPaginate walks every row exactly once, in order', async () => {
    await seed(9);

    const seen: string[] = [];
    let cursor = null as any;

    do {
      const page = await Post.query().orderBy('created_at', 'asc').cursorPaginate(4, cursor, ['*'], { path: '/posts' });
      seen.push(...titles(page));
      cursor = page.nextCursor();
    } while (cursor !== null);

    expect(seen).toEqual(Array.from({ length: 9 }, (_, index) => `Post ${index + 1}`));
  });

  it('cursor pages travel back to the start as exactly as forward', async () => {
    await seed(9);

    const first = await Post.query().orderBy('created_at', 'asc').cursorPaginate(4, null, ['*'], { path: '/posts' });
    const second = await Post.query()
      .orderBy('created_at', 'asc')
      .cursorPaginate(4, first.nextCursor(), ['*'], { path: '/posts' });
    const backAgain = await Post.query()
      .orderBy('created_at', 'asc')
      .cursorPaginate(4, second.previousCursor(), ['*'], { path: '/posts' });

    expect(titles(second)).toEqual(['Post 5', 'Post 6', 'Post 7', 'Post 8']);
    expect(titles(backAgain)).toEqual(titles(first));
    expect(backAgain.previousCursor()).toBeNull();
  });

  it('cursor links preserve the request query string', async () => {
    await seed(9);

    resolveCurrentRequestUsing(() => ({ path: '/posts', query: { filter: 'fresh' } }));

    const page = await Post.query().orderBy('created_at', 'asc').cursorPaginate(4);
    const nextUrl = page.nextPageUrl();

    expect(nextUrl).toContain('/posts?filter=fresh&cursor=');

    const decoded = new URL(`http://localhost${nextUrl}`).searchParams;
    expect(decoded.get('filter')).toBe('fresh');
  });

  it('resource collections wrap paginated models with their meta', async () => {
    await seed(5);

    const page = await Post.query().orderBy('id', 'asc').paginate(2, 1, ['*'], { path: '/posts' });
    const payload = PostResource.collection(page).toJSONPayload() as any;

    // whenLoaded drops the unloaded relation instead of spelling it null
    expect(payload.data).toEqual([
      { id: 1, title: 'Post 1' },
      { id: 2, title: 'Post 2' },
    ]);

    expect(payload.meta).toEqual({
      total: 5,
      per_page: 2,
      last_page: 3,
      next_page_url: '/posts?page=2',
      prev_page_url: null,
    });
  });

  it('eager-loaded relations flow through whenLoaded into the response', async () => {
    await seed(2);

    const page = await Post.query().with('comments').orderBy('id', 'asc').paginate(2, 1, ['*'], { path: '/posts' });
    const payload = PostResource.collection(page).toJSONPayload() as any;

    expect(payload.data[0].comments).toHaveLength(1);
    expect(payload.data[0].comments[0].body).toBe('Comment on 1');
    expect(payload.meta.total).toBe(2);
  });

  it('a single new PostResource renders one model with conditionals', async () => {
    await seed(1);

    const model = await Post.query().with('comments').first();
    const resource = new PostResource(model);

    const payload = resource.toJSONPayload() as any;

    expect(payload.data.id).toBe(1);
    expect(payload.data.comments).toHaveLength(1);
  });
});
