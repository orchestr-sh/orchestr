/**
 * Ensemble relationship queries against a real SQLite database
 *
 * The unit suite pins the compiled SQL; this one proves the behaviour the
 * ticket promises: existence filters keep the right rows, aggregates attach the
 * right values under the right names, soft-deleted related rows stay out of
 * both, and a page of models costs a fixed number of statements instead of one
 * per row.
 *
 * better-sqlite3 is an optional dependency (and needs a native build), so the
 * integration suite only runs when the driver is actually installed.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DrizzleAdapter } from '@/Database/Adapters/DrizzleAdapter';
import { DatabaseManager } from '@/Database/DatabaseManager';
import { Ensemble } from '@/Database/Ensemble/Ensemble';
import { EnsembleCollection } from '@/Database/Ensemble/EnsembleCollection';

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
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT
  );
  CREATE TABLE posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    title TEXT,
    views INTEGER,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT
  );
  CREATE TABLE comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER,
    approved INTEGER,
    votes INTEGER,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT
  );
  CREATE TABLE tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT
  );
  CREATE TABLE post_tag (
    post_id INTEGER,
    tag_id INTEGER
  );
  CREATE TABLE images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    imageable_id INTEGER,
    imageable_type TEXT,
    size INTEGER
  );
  CREATE TABLE nodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    parent_id INTEGER,
    label TEXT
  );
`;

// ---------------------------------------------------------------------------
// Test models
// ---------------------------------------------------------------------------

class User extends Ensemble {
  static softDeletes = true;
  static fillable: string[] = ['name'];

  getTable(): string {
    return 'users';
  }

  posts() {
    return this.hasMany(Post, 'user_id');
  }

  images() {
    return this.morphMany(Image, 'imageable');
  }
}

class Post extends Ensemble {
  static softDeletes = true;
  static fillable: string[] = ['user_id', 'title', 'views'];

  getTable(): string {
    return 'posts';
  }

  comments() {
    return this.hasMany(Comment, 'post_id');
  }

  user() {
    return this.belongsTo(User, 'user_id');
  }

  tags() {
    return this.belongsToMany(Tag, 'post_tag', 'post_id', 'tag_id');
  }

  images() {
    return this.morphMany(Image, 'imageable');
  }
}

class Comment extends Ensemble {
  static softDeletes = true;
  static fillable: string[] = ['post_id', 'approved', 'votes'];

  getTable(): string {
    return 'comments';
  }

  post() {
    return this.belongsTo(Post, 'post_id');
  }
}

class Tag extends Ensemble {
  static fillable: string[] = ['name'];

  getTable(): string {
    return 'tags';
  }

  posts() {
    return this.belongsToMany(Post, 'post_tag', 'tag_id', 'post_id');
  }
}

class Image extends Ensemble {
  static fillable: string[] = ['imageable_id', 'imageable_type', 'size'];

  getTable(): string {
    return 'images';
  }

  imageable() {
    return this.morphTo('imageable');
  }
}

/** A self-relation: parent and child share one table */
class Node extends Ensemble {
  static fillable: string[] = ['parent_id', 'label'];

  getTable(): string {
    return 'nodes';
  }

  children() {
    return this.hasMany(Node, 'parent_id');
  }
}

describe.skipIf(!WITH_BETTER_SQLITE)('Ensemble relationship queries (better-sqlite3)', () => {
  let adapter: DrizzleAdapter;
  let statements: string[];

  beforeEach(async () => {
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

    // Record every statement the models run: that count is how "no N+1" is
    // measured here, rather than by eyeballing generated SQL.
    statements = [];
    const select = adapter.select.bind(adapter);
    adapter.select = ((sql: string, bindings?: any[]) => {
      statements.push(sql);
      return select(sql, bindings);
    }) as typeof adapter.select;
  });

  afterEach(async () => {
    await adapter.disconnect();
  });

  /**
   * A user with `postCount` posts, each carrying `commentCount` comments whose
   * votes run 1..n and whose first comment is approved
   */
  async function seedUser(name: string, postCount: number, commentCount: number): Promise<User> {
    const user = await User.create({ name });

    for (let index = 0; index < postCount; index++) {
      const post = await user.posts().create({ title: `${name} post ${index}`, views: 10 * (index + 1) });

      for (let comment = 0; comment < commentCount; comment++) {
        await post.comments().create({ approved: comment === 0, votes: comment + 1 });
      }
    }

    return user;
  }

  const titles = (posts: Post[]) => posts.map((post) => post.getAttribute('title'));
  const names = (users: User[]) => users.map((user) => user.getAttribute('name'));

  // -------------------------------------------------------------------------
  // Existence filters
  // -------------------------------------------------------------------------

  it('returns only the rows a relation has at least one row for', async () => {
    await seedUser('Ada', 2, 1);
    await seedUser('Grace', 1, 0);

    expect(titles(await Post.query().has('comments').get())).toEqual(['Ada post 0', 'Ada post 1']);
    expect(titles(await Post.query().doesntHave('comments').get())).toEqual(['Grace post 0']);
  });

  it('compares a counted condition against the real number of related rows', async () => {
    const ada = await seedUser('Ada', 1, 3);
    await seedUser('Grace', 1, 1);

    expect(titles(await Post.query().has('comments', '>=', 2).get())).toEqual(['Ada post 0']);
    expect(titles(await Post.query().has('comments', '=', 1).get())).toEqual(['Grace post 0']);
    expect(titles(await Post.query().has('comments', 2).get())).toEqual(['Ada post 0']);
    expect(await ada.posts().getResults()).toHaveLength(1);
  });

  it('lets a whereHas callback constrain the related query', async () => {
    const ada = await seedUser('Ada', 2, 1);

    // Both posts have one approved comment; unapprove the first post's comment
    const posts = await ada.posts().getResults();
    const [comment] = await posts[0].comments().getResults();
    comment.setAttribute('approved', false);
    await comment.save();

    // The callback takes the related query, so its constraints belong to the
    // sub-select and only posts with a matching comment survive
    const withApproved = (approved: boolean) =>
      Post.query().whereHas('comments', (query: any) => query.where('approved', approved));

    expect(titles(await withApproved(true).get())).toEqual(['Ada post 1']);
    expect(titles(await withApproved(false).get())).toEqual(['Ada post 0']);
  });

  it('constrains a related query by a column with whereRelation', async () => {
    await seedUser('Ada', 1, 2);

    expect(titles(await Post.query().whereRelation('comments', 'votes', '=', 1).get())).toEqual(['Ada post 0']);
    expect(titles(await Post.query().whereRelation('comments', 'votes', '>', 1).get())).toEqual(['Ada post 0']);
    expect(await Post.query().whereRelation('comments', 'votes', '=', 99).get()).toHaveLength(0);
  });

  it('nests existence checks through a dotted relation path', async () => {
    await seedUser('Ada', 2, 1); // some posts carry comments
    await seedUser('Grace', 1, 0); // no comments anywhere
    await seedUser('Hopper', 1, 3); // one post carries three comments

    expect(names(await User.query().whereHas('posts.comments').get())).toEqual(['Ada', 'Hopper']);
    expect(names(await User.query().whereDoesntHave('posts.comments').get())).toEqual(['Grace']);

    // The count applies to the deepest step: a post with at least two comments
    expect(names(await User.query().has('posts.comments', '>=', 2).get())).toEqual(['Hopper']);
    expect(await User.query().has('posts.comments', '>=', 4).get()).toHaveLength(0);
  });

  it('joins existence conditions with OR', async () => {
    await seedUser('Ada', 1, 1);
    await seedUser('Grace', 1, 0);

    const posts = await Post.query().where('title', '=', 'Grace post 0').orHas('comments').get();
    expect(titles(posts).sort()).toEqual(['Ada post 0', 'Grace post 0']);

    const missing = await Post.query().where('title', '=', 'Ada post 0').orDoesntHave('comments').get();
    expect(titles(missing).sort()).toEqual(['Ada post 0', 'Grace post 0']);
  });

  it('filters by an inverse relation with whereBelongsTo', async () => {
    const ada = await seedUser('Ada', 1, 0);
    const grace = await seedUser('Grace', 1, 0);
    await seedUser('Hopper', 1, 0);

    expect(titles(await Post.query().whereBelongsTo(ada).get())).toEqual(['Ada post 0']);
    expect(titles(await Post.query().whereBelongsTo([ada, grace]).get()).sort()).toEqual([
      'Ada post 0',
      'Grace post 0',
    ]);
    expect(titles(await Post.query().where('title', '=', 'Ada post 0').orWhereBelongsTo(grace).get()).sort()).toEqual([
      'Ada post 0',
      'Grace post 0',
    ]);
  });

  it('reaches a many-to-many target through its pivot', async () => {
    const hello = await Post.create({ title: 'Hello', views: 1 });
    const news = await Tag.create({ name: 'news' });

    await hello.tags().attach([news.getKey()]);

    expect(titles(await Post.query().has('tags').get())).toEqual(['Hello']);
    expect(await Post.query().doesntHave('tags').get()).toHaveLength(0);

    await hello.tags().detach();

    expect(await Post.query().has('tags').count()).toBe(0);
    expect(titles(await Post.query().doesntHave('tags').get())).toEqual(['Hello']);
  });

  it('constrains a polymorphic existence check by morph type', async () => {
    const post = await Post.create({ title: 'Hello', views: 1 });
    const user = await User.create({ name: 'Ada' });

    await post.images().create({ size: 100 });
    await user.images().create({ size: 200 });

    expect(titles(await Post.query().has('images').get())).toEqual(['Hello']);
    expect(names(await User.query().has('images').get())).toEqual(['Ada']);
    expect(await Tag.query().has('posts').get()).toHaveLength(0);
  });

  it('says so when a polymorphic inverse relation is filtered', async () => {
    expect(() => Image.query().has('imageable')).toThrow(/does not support existence/);
  });

  it('cannot correlate an existence check over a self-relation, but aggregates it fine', async () => {
    const root = await Node.create({ label: 'root' });
    await root.children().create({ label: 'leaf' });
    await root.children().create({ label: 'branch' });

    // A correlated sub-select would need a table alias the builder has none of
    expect(() => Node.query().has('children')).toThrow(/shares its parent table/);

    // An aggregate groups by a key, so the shared table is not a problem
    const nodes = await Node.query().orderBy('id').withCount('children').get();

    expect(nodes.map((node) => node.getAttribute('children_count'))).toEqual([2, 0, 0]);
  });

  // -------------------------------------------------------------------------
  // Aggregates
  // -------------------------------------------------------------------------

  it('attaches counts to every model of the query', async () => {
    await seedUser('Ada', 2, 3);
    await seedUser('Grace', 1, 0);
    await User.create({ name: 'No posts' });

    const users = await User.query().withCount('posts').get();

    expect(users.map((user) => user.getAttribute('posts_count'))).toEqual([2, 1, 0]);
    expect(names(users)).toEqual(['Ada', 'Grace', 'No posts']);
  });

  it('attaches sums, averages, minimums and maximums under their own names', async () => {
    await seedUser('Ada', 1, 3);

    const [post] = await Post.query()
      .withSum('comments', 'votes')
      .withAvg('comments', 'votes')
      .withMax('comments', 'votes')
      .withMin('comments', 'votes')
      .get();

    expect(post.getAttribute('comments_sum_votes')).toBe(6);
    expect(post.getAttribute('comments_avg_votes')).toBe(2);
    expect(post.getAttribute('comments_max_votes')).toBe(3);
    expect(post.getAttribute('comments_min_votes')).toBe(1);
  });

  it('attaches a boolean for withExists', async () => {
    await seedUser('Ada', 1, 1);
    await seedUser('Grace', 1, 0);

    const posts = await Post.query().withExists('comments').get();

    expect(posts.map((post) => post.getAttribute('comments_exists'))).toEqual([true, false]);
  });

  it('aggregates a many-to-many relation through the pivot', async () => {
    const hello = await Post.create({ title: 'Hello', views: 1 });
    const world = await Post.create({ title: 'World', views: 1 });
    const news = await Tag.create({ name: 'news' });
    const tech = await Tag.create({ name: 'tech' });

    await hello.tags().attach([news.getKey(), tech.getKey()]);
    await world.tags().attach([news.getKey()]);

    const posts = await Post.query().withCount('tags').get();
    expect(posts.map((post) => post.getAttribute('tags_count'))).toEqual([2, 1]);

    const tags = await Tag.query().withCount('posts').get();
    expect(tags.map((tag) => [tag.getAttribute('name'), tag.getAttribute('posts_count')])).toEqual([
      ['news', 2],
      ['tech', 1],
    ]);
  });

  it('aggregates a polymorphic relation by morph type', async () => {
    const post = await Post.create({ title: 'Hello', views: 1 });
    await post.images().create({ size: 10 });
    await post.images().create({ size: 20 });

    const user = await User.create({ name: 'Ada' });
    await user.images().create({ size: 30 });

    const [loaded] = await Post.query().withCount('images').withSum('images', 'size').get();

    expect(loaded.getAttribute('images_count')).toBe(2);
    expect(loaded.getAttribute('images_sum_size')).toBe(30);

    const [person] = await User.query().withCount('images').get();
    expect(person.getAttribute('images_count')).toBe(1);
  });

  it('counts an inverse relation', async () => {
    await seedUser('Ada', 2, 0);
    await User.create({ name: 'No posts' });

    const posts = await Post.query().withCount('user').get();
    expect(posts.map((post) => post.getAttribute('user_count'))).toEqual([1, 1]);

    const users = await User.query().withCount('posts').get();
    expect(users.map((user) => user.getAttribute('posts_count'))).toEqual([2, 0]);
  });

  it('aliases aggregates through the relation map and the "as" spelling', async () => {
    await seedUser('Ada', 1, 2);

    const [byMap] = await Post.query().withCount({ comments: 'pending_count' }).get();
    expect(byMap.getAttribute('pending_count')).toBe(2);
    expect(byMap.getAttribute('comments_count')).toBeUndefined();

    const [byAs] = await Post.query().withCount('comments as all_comments').get();
    expect(byAs.getAttribute('all_comments')).toBe(2);

    const [constrained] = await Post.query()
      .withCount({ 'comments as approved_count': (query: any) => query.where('approved', '=', true) })
      .get();
    expect(constrained.getAttribute('approved_count')).toBe(1);

    const [byFunction] = await Post.query().withSum({ comments: 'total_votes' }, 'votes').get();
    expect(byFunction.getAttribute('total_votes')).toBe(3);
  });

  it('loads aggregates onto an existing model after the fact', async () => {
    await seedUser('Ada', 2, 3);

    const [user] = await User.query().where('name', '=', 'Ada').get();
    expect(user.getAttribute('posts_count')).toBeUndefined();

    await user.loadCount('posts');
    expect(user.getAttribute('posts_count')).toBe(2);

    await user.loadSum('posts', 'views');
    expect(user.getAttribute('posts_sum_views')).toBe(30);

    await user.loadExists('posts');
    expect(user.getAttribute('posts_exists')).toBe(true);

    await user.loadAvg('posts', 'views');
    await user.loadMin('posts', 'views');
    await user.loadMax('posts', 'views');
    expect(user.getAttribute('posts_avg_views')).toBe(15);
    expect(user.getAttribute('posts_min_views')).toBe(10);
    expect(user.getAttribute('posts_max_views')).toBe(20);
  });

  it('loads aggregates onto a whole collection in one query per relation', async () => {
    await seedUser('Ada', 2, 0);
    await seedUser('Grace', 1, 0);

    const collection = new EnsembleCollection<User>(await User.query().get());

    statements.length = 0;
    await collection.loadCount(['posts', 'images']);

    expect(statements).toHaveLength(2);
    expect(collection[0].getAttribute('posts_count')).toBe(2);
    expect(collection[1].getAttribute('posts_count')).toBe(1);
    expect(collection[0].getAttribute('images_count')).toBe(0);
  });

  it('excludes soft-deleted related rows from counts and existence checks', async () => {
    const ada = await seedUser('Ada', 2, 1);

    const posts = await ada.posts().getResults();
    const [comment] = await posts[0].comments().getResults();
    await comment.delete();

    expect(titles(await Post.query().has('comments').get())).toEqual(['Ada post 1']);
    expect((await Post.query().withCount('comments').get()).map((post) => post.getAttribute('comments_count'))).toEqual(
      [0, 1]
    );
    expect(await Post.query().has('comments', '>=', 1).count()).toBe(1);

    // Opting the relations into trashed rows brings them back
    expect(
      (await Post.query().withTrashedRelations().has('comments', '>=', 1).get()).map((post) =>
        post.getAttribute('title')
      )
    ).toEqual(['Ada post 0', 'Ada post 1']);
    expect(
      (await Post.query().withTrashedRelations().withCount('comments').get()).map((post) =>
        post.getAttribute('comments_count')
      )
    ).toEqual([1, 1]);
  });

  it('excludes a soft-deleted parent from an inverse relation aggregate', async () => {
    const ada = await seedUser('Ada', 1, 0);
    await seedUser('Grace', 1, 0);

    await ada.delete();

    const posts = await Post.query().has('user').withCount('user').get();
    expect(titles(posts)).toEqual(['Grace post 0']);
    expect(posts[0].getAttribute('user_count')).toBe(1);

    const everything = await Post.query().withTrashedRelations().withCount('user').get();
    expect(everything.map((post) => post.getAttribute('user_count'))).toEqual([1, 1]);
  });

  it('excludes soft-deleted rows from a nested existence path', async () => {
    const ada = await seedUser('Ada', 1, 1);

    const [post] = await ada.posts().getResults();
    const [comment] = await post.comments().getResults();
    await comment.delete();

    expect(names(await User.query().whereHas('posts.comments').get())).toEqual([]);
    expect(names(await User.query().whereDoesntHave('posts.comments').get())).toEqual(['Ada']);
  });

  it('runs one statement per aggregate however many models came back', async () => {
    for (const name of ['Ada', 'Grace', 'Hopper', 'Noether']) {
      await seedUser(name, 2, 1);
    }

    statements.length = 0;

    const users = await User.query().withCount('posts').withSum('posts', 'views').get();

    expect(users).toHaveLength(4);
    // one for the users, one for the counts, one for the sums
    expect(statements).toHaveLength(3);
    expect(users[0].getAttribute('posts_sum_views')).toBe(30);
  });

  it('keeps eager loads and aggregates at a fixed statement count', async () => {
    await seedUser('Ada', 2, 1);
    await seedUser('Grace', 3, 1);

    statements.length = 0;

    const users = await User.query().with('posts').withCount('posts').withExists('posts').get();

    // one select for the users, one for the eager load, one per aggregate
    expect(statements).toHaveLength(4);
    expect(users[0].getAttribute('posts_count')).toBe(2);
    expect(users[0].getAttribute('posts_exists')).toBe(true);
    expect(users[0].getRelation('posts')).toHaveLength(2);
  });

  it('counts aggregates on a paginated result', async () => {
    await seedUser('Ada', 2, 1);
    await seedUser('Grace', 1, 1);

    const page = await User.query().withCount('posts').paginate(1, 2);

    expect(page.total).toBe(2);
    expect(page.data[0].getAttribute('posts_count')).toBe(1);
  });

  it('leaves the model unchanged apart from the attached aggregate', async () => {
    await seedUser('Ada', 1, 1);

    const [user] = await User.query().withCount('posts').get();

    expect(user.isDirty()).toBe(false);
    expect(user.toObject().posts_count).toBe(1);
    expect(user.toObject().name).toBe('Ada');
  });
});
