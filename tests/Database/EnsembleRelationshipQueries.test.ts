/**
 * Ensemble relationship query tests
 *
 * Existence filters (`has`, `whereHas`, ...) and eager loaded aggregates are
 * pinned as SQL here, against a recording adapter: which sub-select is built,
 * how it correlates with the outer query, which alias a value lands under, and
 * which scopes that sub-select inherits. The SQLite suite proves the same
 * queries behave the way the ticket promises against a real database.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Scope } from '@/Database/Ensemble/Scope';
import { DatabaseManager } from '@/Database/DatabaseManager';
import { Ensemble } from '@/Database/Ensemble/Ensemble';
import { EnsembleBuilder } from '@/Database/Ensemble/EnsembleBuilder';
import { EnsembleCollection } from '@/Database/Ensemble/EnsembleCollection';
import { recordAdapter, type ExecutedQuery } from './Query/support';

// ---------------------------------------------------------------------------
// Recording helpers
// ---------------------------------------------------------------------------

function useRecorder(results: Record<string, any> = {}): ExecutedQuery[] {
  const { adapter, queries } = recordAdapter(results);

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

/**
 * A recorder whose SELECT statements consume queued row sets in call order, so
 * a parent query and the aggregate loads hanging off it can return different
 * fixtures.
 */
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

class User extends Ensemble {
  static softDeletes = true;
  static fillable: string[] = ['name'];

  getTable(): string {
    return 'users';
  }

  posts() {
    return this.hasMany(Post, 'user_id');
  }

  profile() {
    return this.hasOne(Profile, 'user_id');
  }

  roles() {
    return this.belongsToMany(Role, 'role_user', 'user_id', 'role_id');
  }
}

class Post extends Ensemble {
  static softDeletes = true;
  static fillable: string[] = ['title', 'user_id'];

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

  taggings() {
    return this.morphToMany(Tag, 'taggable');
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

class Profile extends Ensemble {
  static fillable: string[] = ['user_id', 'bio'];

  getTable(): string {
    return 'profiles';
  }
}

class Role extends Ensemble {
  static fillable: string[] = ['name'];

  getTable(): string {
    return 'roles';
  }
}

class Tag extends Ensemble {
  static fillable: string[] = ['name'];

  getTable(): string {
    return 'tags';
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

// ---------------------------------------------------------------------------
// Existence queries
// ---------------------------------------------------------------------------

describe('Ensemble relationship existence queries', () => {
  beforeEach(() => {
    useRecorder();
  });

  it('filters by relation existence with a correlated EXISTS sub-select', () => {
    const builder = Post.query().has('comments');

    expect(builder.toSql()).toBe(
      'SELECT * FROM "posts" WHERE EXISTS (SELECT * FROM "comments" ' +
        'WHERE "posts"."id" = "comments"."post_id" AND "comments"."deleted_at" IS NULL)'
    );
    expect(builder.getBindings()).toEqual([]);
  });

  it('correlates a has-one relation the same way as a has-many one', () => {
    expect(User.query().has('profile').toSql()).toBe(
      'SELECT * FROM "users" WHERE EXISTS (SELECT * FROM "profiles" WHERE "users"."id" = "profiles"."user_id")'
    );
  });

  it('correlates an inverse relation through the parent foreign key', () => {
    expect(Comment.query().has('post').toSql()).toBe(
      'SELECT * FROM "comments" WHERE EXISTS (SELECT * FROM "posts" ' +
        'WHERE "posts"."id" = "comments"."post_id" AND "posts"."deleted_at" IS NULL)'
    );
  });

  it('reaches a many-to-many target through its pivot join', () => {
    expect(User.query().has('roles').toSql()).toBe(
      'SELECT * FROM "users" WHERE EXISTS (SELECT * FROM "roles" ' +
        'INNER JOIN "role_user" ON "roles"."id" = "role_user"."role_id" ' +
        'WHERE "users"."id" = "role_user"."user_id")'
    );
  });

  it('reaches a polymorphic many-to-many target through its pivot and morph type', () => {
    const builder = Post.query().has('taggings');

    expect(builder.toSql()).toBe(
      'SELECT * FROM "posts" WHERE EXISTS (SELECT * FROM "tags" ' +
        'INNER JOIN "taggables" ON "tags"."id" = "taggables"."tag_id" ' +
        'WHERE "taggables"."taggable_type" = ? AND "posts"."id" = "taggables"."taggable_id")'
    );
    expect(builder.getBindings()).toEqual(['Post']);
  });

  it('constrains a polymorphic one-to-many sub-select by morph type', () => {
    const builder = Post.query().has('images');

    expect(builder.toSql()).toBe(
      'SELECT * FROM "posts" WHERE EXISTS (SELECT * FROM "images" ' +
        'WHERE "images"."imageable_type" = ? AND "posts"."id" = "images"."imageable_id")'
    );
    expect(builder.getBindings()).toEqual(['Post']);
  });

  it('compares a counted sub-select when the condition needs more rows', () => {
    const builder = Post.query().has('comments', '>=', 2);

    expect(builder.toSql()).toBe(
      'SELECT * FROM "posts" WHERE (SELECT COUNT(*) as aggregate FROM "comments" ' +
        'WHERE "posts"."id" = "comments"."post_id" AND "comments"."deleted_at" IS NULL) >= ?'
    );
    expect(builder.getBindings()).toEqual([2]);
  });

  it('counts a many-to-many sub-select through the pivot', () => {
    const builder = User.query().has('roles', '>', 1);

    expect(builder.toSql()).toBe(
      'SELECT * FROM "users" WHERE (SELECT COUNT(*) as aggregate FROM "roles" ' +
        'INNER JOIN "role_user" ON "roles"."id" = "role_user"."role_id" ' +
        'WHERE "users"."id" = "role_user"."user_id") > ?'
    );
    expect(builder.getBindings()).toEqual([1]);
  });

  it('takes a bare count as the short form of the counted condition', () => {
    const builder = Post.query().has('comments', 3);

    expect(builder.toSql()).toContain(') >= ?');
    expect(builder.getBindings()).toEqual([3]);
  });

  it('inverts the existence check for a "does not have" condition', () => {
    expect(Post.query().doesntHave('comments').toSql()).toBe(
      'SELECT * FROM "posts" WHERE NOT EXISTS (SELECT * FROM "comments" ' +
        'WHERE "posts"."id" = "comments"."post_id" AND "comments"."deleted_at" IS NULL)'
    );
  });

  it('joins an or-has condition with OR', () => {
    const builder = Post.query().where('title', '=', 'Hello').orHas('comments');

    expect(builder.toSql()).toContain(' OR EXISTS (');
    expect(builder.getBindings()).toEqual(['Hello']);
  });

  it('joins an or-doesnt-have condition with OR', () => {
    expect(Post.query().where('title', '=', 'Hello').orDoesntHave('comments').toSql()).toContain(' OR NOT EXISTS (');
  });

  it('lets a callback constrain the related query, keeping binding order', () => {
    const builder = Post.query().whereHas('comments', (query: EnsembleBuilder<Comment>) =>
      query.where('approved', '=', true)
    );

    expect(builder.toSql()).toBe(
      'SELECT * FROM "posts" WHERE EXISTS (SELECT * FROM "comments" ' +
        'WHERE "posts"."id" = "comments"."post_id" AND "approved" = ? AND "comments"."deleted_at" IS NULL)'
    );
    expect(builder.getBindings()).toEqual([true]);
  });

  it('combines a callback constraint with a counted condition', () => {
    const builder = Post.query().whereHas(
      'comments',
      (query: EnsembleBuilder<Comment>) => query.where('votes', '>', 5),
      '>',
      2
    );

    expect(builder.toSql()).toBe(
      'SELECT * FROM "posts" WHERE (SELECT COUNT(*) as aggregate FROM "comments" ' +
        'WHERE "posts"."id" = "comments"."post_id" AND "votes" > ? AND "comments"."deleted_at" IS NULL) > ?'
    );
    expect(builder.getBindings()).toEqual([5, 2]);
  });

  it('joins a constrained condition with OR', () => {
    const builder = Post.query().where('title', '=', 'Hi').orWhereHas('comments');

    expect(builder.toSql()).toContain(' OR EXISTS (');
    expect(builder.getBindings()).toEqual(['Hi']);
  });

  it('nests one existence check per segment of a dotted relation path', () => {
    const builder = User.query().whereHas('posts.comments');

    expect(builder.toSql()).toBe(
      'SELECT * FROM "users" WHERE EXISTS (SELECT * FROM "posts" ' +
        'WHERE "users"."id" = "posts"."user_id" AND EXISTS (SELECT * FROM "comments" ' +
        'WHERE "posts"."id" = "comments"."post_id" AND "comments"."deleted_at" IS NULL) ' +
        'AND "posts"."deleted_at" IS NULL)'
    );
  });

  it('applies the operator to the deepest segment of a nested path', () => {
    const builder = User.query().has('posts.comments', '>=', 2);

    expect(builder.toSql()).toContain('AND (SELECT COUNT(*) as aggregate FROM "comments"');
    expect(builder.getBindings()).toEqual([2]);
  });

  it('runs a whereHas callback on the deepest step of a nested path', () => {
    const builder = User.query().whereHas('posts.comments', (query: EnsembleBuilder<Comment>) =>
      query.where('approved', '=', 1)
    );

    expect(builder.toSql()).toBe(
      'SELECT * FROM "users" WHERE EXISTS (SELECT * FROM "posts" ' +
        'WHERE "users"."id" = "posts"."user_id" AND EXISTS (SELECT * FROM "comments" ' +
        'WHERE "posts"."id" = "comments"."post_id" AND "approved" = ? AND "comments"."deleted_at" IS NULL) ' +
        'AND "posts"."deleted_at" IS NULL)'
    );
    expect(builder.getBindings()).toEqual([1]);
  });

  it('inverts a nested "does not have" path at the outermost step', () => {
    const builder = User.query().whereDoesntHave('posts.comments');

    // Only the outer step is inverted: the path asks for no rows where the
    // whole chain exists, so the inner segments stay plain existence checks.
    expect(builder.toSql()).toBe(
      'SELECT * FROM "users" WHERE NOT EXISTS (SELECT * FROM "posts" ' +
        'WHERE "users"."id" = "posts"."user_id" AND EXISTS (SELECT * FROM "comments" ' +
        'WHERE "posts"."id" = "comments"."post_id" AND "comments"."deleted_at" IS NULL) ' +
        'AND "posts"."deleted_at" IS NULL)'
    );
  });

  it('constrains a related query by a column with whereRelation', () => {
    const builder = Post.query().whereRelation('comments', 'approved', '=', true);

    expect(builder.toSql()).toBe(
      'SELECT * FROM "posts" WHERE EXISTS (SELECT * FROM "comments" ' +
        'WHERE "posts"."id" = "comments"."post_id" AND "approved" = ? AND "comments"."deleted_at" IS NULL)'
    );
    expect(builder.getBindings()).toEqual([true]);
  });

  it('accepts the value shorthand of whereRelation', () => {
    expect(Post.query().whereRelation('comments', 'approved', true).getBindings()).toEqual([true]);
  });

  it('joins a relation column constraint with OR', () => {
    const builder = Post.query().where('title', '=', 'Hi').orWhereRelation('comments', 'approved', true);

    expect(builder.toSql()).toContain(' OR EXISTS (');
    expect(builder.getBindings()).toEqual(['Hi', true]);
  });

  it('filters by an inverse relation with whereBelongsTo', () => {
    const builder = Post.query().whereBelongsTo(new User({ id: 7, name: 'Ada' }, true));

    expect(builder.toSql()).toBe('SELECT * FROM "posts" WHERE "posts"."user_id" IN (?)');
    expect(builder.getBindings()).toEqual([7]);
  });

  it('accepts several models and an explicit relationship name', () => {
    const builder = Post.query().whereBelongsTo([new User({ id: 7 }, true), new User({ id: 9 }, true)], 'user');

    expect(builder.toSql()).toBe('SELECT * FROM "posts" WHERE "posts"."user_id" IN (?, ?)');
    expect(builder.getBindings()).toEqual([7, 9]);
  });

  it('joins an or-where-belongs-to condition with OR', () => {
    const builder = Post.query()
      .where('title', '=', 'Hi')
      .orWhereBelongsTo(new User({ id: 7 }, true));

    expect(builder.toSql()).toContain(' OR "posts"."user_id" IN (?)');
  });

  it('rejects a belongs-to condition for a relationship that is not one', () => {
    expect(() => Post.query().whereBelongsTo(new Tag({ id: 1 }, true), 'tags')).toThrow(/not a belongs-to/);
  });

  it('rejects an empty model list', () => {
    expect(() => Post.query().whereBelongsTo([])).toThrow(/may not be empty/);
  });

  it('says so for a polymorphic inverse relation, which has no single table', () => {
    expect(() => Image.query().has('imageable')).toThrow(/MorphTo\] does not support existence/);
  });

  it('lifts the soft-delete exclusion on sub-selects for trashed relations', () => {
    const builder = Post.query().withTrashedRelations().has('comments');

    expect(builder.toSql()).toBe(
      'SELECT * FROM "posts" WHERE EXISTS (SELECT * FROM "comments" WHERE "posts"."id" = "comments"."post_id")'
    );
  });

  it('runs the existence filter as part of the query it is chained onto', async () => {
    const queries = useRecorder({ select: [{ id: 1, title: 'Hello' }] });

    const posts = await Post.query().has('comments').get();

    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toContain('WHERE EXISTS (');
    expect(posts[0]).toBeInstanceOf(Post);
  });
});

// ---------------------------------------------------------------------------
// Aggregates
// ---------------------------------------------------------------------------

describe('Ensemble relationship aggregates', () => {
  beforeEach(() => {
    useRecorder();
  });

  it('eager loads counts with one grouped query, not one per model', async () => {
    const queries = useSelectQueue([
      [
        { id: 1, name: 'Ada' },
        { id: 2, name: 'Grace' },
      ],
      [
        { aggregate_key: 1, aggregate: 3 },
        { aggregate_key: 2, aggregate: 1 },
      ],
    ]);

    const users = await User.query().withCount('posts').get();

    expect(queries).toHaveLength(2);
    expect(queries[1].sql).toBe(
      'SELECT "posts"."user_id" as "aggregate_key", COUNT(*) as aggregate FROM "posts" ' +
        'WHERE "posts"."user_id" IN (?, ?) AND "posts"."deleted_at" IS NULL GROUP BY "posts"."user_id"'
    );
    expect(queries[1].bindings).toEqual([1, 2]);

    expect(users[0].getAttribute('posts_count')).toBe(3);
    expect(users[1].getAttribute('posts_count')).toBe(1);
  });

  it('attaches the empty value for models the grouped query has no row for', async () => {
    useSelectQueue([
      [
        { id: 1, name: 'Ada' },
        { id: 2, name: 'Grace' },
      ],
    ]);

    const users = await User.query().withCount('posts').get();

    expect(users[0].getAttribute('posts_count')).toBe(0);
    expect(users[1].getAttribute('posts_count')).toBe(0);
  });

  it('names each aggregate after its relation, function and column', async () => {
    useSelectQueue([
      [{ id: 1, title: 'Hello' }],
      [{ aggregate_key: 1, aggregate: 40 }],
      [{ aggregate_key: 1, aggregate: 8 }],
      [{ aggregate_key: 1, aggregate: 5 }],
      [{ aggregate_key: 1, aggregate: 2 }],
      [{ aggregate_key: 1, aggregate: 12 }],
    ]);

    const [post] = await Post.query()
      .withSum('comments', 'votes')
      .withAvg('comments', 'votes')
      .withMin('comments', 'votes')
      .withMax('comments', 'votes')
      .withCount('comments')
      .get();

    expect(post.getAttribute('comments_sum_votes')).toBe(40);
    expect(post.getAttribute('comments_avg_votes')).toBe(8);
    expect(post.getAttribute('comments_min_votes')).toBe(5);
    expect(post.getAttribute('comments_max_votes')).toBe(2);
    expect(post.getAttribute('comments_count')).toBe(12);
  });

  it('summarises the aggregate column in the SQL it runs', async () => {
    const queries = useSelectQueue([[{ id: 1, title: 'Hello' }], [{ aggregate_key: 1, aggregate: 40 }]]);

    await Post.query().withSum('comments', 'votes').get();

    expect(queries[1].sql).toBe(
      'SELECT "comments"."post_id" as "aggregate_key", SUM("comments"."votes") as aggregate FROM "comments" ' +
        'WHERE "comments"."post_id" IN (?) AND "comments"."deleted_at" IS NULL GROUP BY "comments"."post_id"'
    );
  });

  it('attaches a boolean for withExists', async () => {
    const queries = useSelectQueue([[{ id: 1, title: 'Hello' }], [{ aggregate_key: 1, aggregate: 2 }]]);

    const [post] = await Post.query().withExists('comments').get();

    expect(post.getAttribute('comments_exists')).toBe(true);
    expect(queries[1].sql).toContain('COUNT(*) as aggregate');

    useSelectQueue([[{ id: 1, title: 'Hello' }], []]);

    const [without] = await Post.query().withExists('comments').get();

    expect(without.getAttribute('comments_exists')).toBe(false);
  });

  it('groups a many-to-many aggregate through the pivot', async () => {
    const queries = useSelectQueue([[{ id: 1, name: 'Ada' }], [{ aggregate_key: 1, aggregate: 2 }]]);

    const [user] = await User.query().withCount('roles').get();

    expect(queries[1].sql).toBe(
      'SELECT "role_user"."user_id" as "aggregate_key", COUNT(*) as aggregate FROM "roles" ' +
        'INNER JOIN "role_user" ON "roles"."id" = "role_user"."role_id" ' +
        'WHERE "role_user"."user_id" IN (?) GROUP BY "role_user"."user_id"'
    );
    expect(user.getAttribute('roles_count')).toBe(2);
  });

  it('constrains a polymorphic aggregate by morph type', async () => {
    const queries = useSelectQueue([[{ id: 1, title: 'Hello' }], [{ aggregate_key: 1, aggregate: 4 }]]);

    await Post.query().withCount('images').get();

    expect(queries[1].sql).toBe(
      'SELECT "images"."imageable_id" as "aggregate_key", COUNT(*) as aggregate FROM "images" ' +
        'WHERE "images"."imageable_type" = ? AND "images"."imageable_id" IN (?) GROUP BY "images"."imageable_id"'
    );
    expect(queries[1].bindings).toEqual(['Post', 1]);
  });

  it('groups an inverse relation aggregate by the owner key', async () => {
    const queries = useSelectQueue([[{ id: 1, user_id: 7 }], [{ aggregate_key: 7, aggregate: 1 }]]);

    const [post] = await Post.query().withCount('user').get();

    expect(queries[1].sql).toBe(
      'SELECT "users"."id" as "aggregate_key", COUNT(*) as aggregate FROM "users" ' +
        'WHERE "users"."id" IN (?) AND "users"."deleted_at" IS NULL GROUP BY "users"."id"'
    );
    expect(post.getAttribute('user_count')).toBe(1);
  });

  it('aliases an aggregate through the relation map', async () => {
    useSelectQueue([[{ id: 1, title: 'Hello' }], [{ aggregate_key: 1, aggregate: 9 }]]);

    const [post] = await Post.query().withCount({ comments: 'pending_count' }).get();

    expect(post.getAttribute('pending_count')).toBe(9);
    expect(post.getAttribute('comments_count')).toBeUndefined();
  });

  it('aliases an aggregate with the "as" spelling and constrains it', async () => {
    const queries = useSelectQueue([[{ id: 1, title: 'Hello' }], [{ aggregate_key: 1, aggregate: 4 }]]);

    const [post] = await Post.query()
      .withCount({ 'comments as approved_count': (query: EnsembleBuilder<Comment>) => query.where('approved', '=', 1) })
      .get();

    expect(post.getAttribute('approved_count')).toBe(4);
    expect(queries[1].sql).toBe(
      'SELECT "comments"."post_id" as "aggregate_key", COUNT(*) as aggregate FROM "comments" ' +
        'WHERE "approved" = ? AND "comments"."post_id" IN (?) AND "comments"."deleted_at" IS NULL ' +
        'GROUP BY "comments"."post_id"'
    );
    expect(queries[1].bindings).toEqual([1, 1]);
  });

  it('eager loads several relations in one call and stays at one query each', async () => {
    const queries = useSelectQueue([
      [{ id: 1, name: 'Ada' }],
      [{ aggregate_key: 1, aggregate: 2 }],
      [{ aggregate_key: 1, aggregate: 1 }],
    ]);

    const [user] = await User.query().withCount(['posts', 'profile']).get();

    expect(user.getAttribute('posts_count')).toBe(2);
    expect(user.getAttribute('profile_count')).toBe(1);
    expect(queries).toHaveLength(3);
  });

  it('respects a global scope inside the aggregate query', async () => {
    class ScopedUser extends Ensemble {
      static fillable: string[] = ['name'];

      getTable(): string {
        return 'scoped_users';
      }

      posts() {
        return this.hasMany(ScopedPost, 'user_id');
      }
    }

    class ScopedPost extends Ensemble {
      static fillable: string[] = ['user_id', 'is_published'];

      getTable(): string {
        return 'scoped_posts';
      }
    }

    const published: Scope = {
      apply(builder: EnsembleBuilder<any>): void {
        builder.where('is_published', '=', 1);
      },
    };

    ScopedPost.addGlobalScope('published', published);

    const queries = useSelectQueue([[{ id: 1 }], [{ aggregate_key: 1, aggregate: 5 }]]);

    await ScopedUser.query().withCount('posts').get();

    expect(queries[1].sql).toBe(
      'SELECT "scoped_posts"."user_id" as "aggregate_key", COUNT(*) as aggregate FROM "scoped_posts" ' +
        'WHERE "scoped_posts"."user_id" IN (?) AND "is_published" = ? GROUP BY "scoped_posts"."user_id"'
    );
    expect(queries[1].bindings).toEqual([1, 1]);
  });

  it('respects a global scope inside an existence sub-select', () => {
    class ScopedComment extends Ensemble {
      static fillable: string[] = ['post_id'];

      getTable(): string {
        return 'scoped_comments';
      }
    }

    ScopedComment.addGlobalScope('approved', (builder: EnsembleBuilder<any>) => builder.where('approved', '=', 1));

    class ScopedArticle extends Ensemble {
      static fillable: string[] = ['title'];

      getTable(): string {
        return 'scoped_articles';
      }

      comments() {
        return this.hasMany(ScopedComment, 'article_id');
      }
    }

    expect(ScopedArticle.query().has('comments').toSql()).toBe(
      'SELECT * FROM "scoped_articles" WHERE EXISTS (SELECT * FROM "scoped_comments" ' +
        'WHERE "scoped_articles"."id" = "scoped_comments"."article_id" AND "approved" = ?)'
    );
  });

  it('attaches aggregates without making the model dirty', async () => {
    useSelectQueue([[{ id: 1, title: 'Hello' }], [{ aggregate_key: 1, aggregate: 3 }]]);

    const [post] = await Post.query().withCount('comments').get();

    expect(post.isDirty()).toBe(false);
    expect(post.toObject().comments_count).toBe(3);
  });

  it('rejects an aggregate over a nested relation path', () => {
    expect(() => User.query().withCount('posts.comments')).toThrow(/Nested aggregate relations/);
  });

  it('keeps aggregates through cloning and pagination', async () => {
    const queries = useSelectQueue([
      [{ aggregate: 2 }],
      [{ id: 1, title: 'Hello' }],
      [{ aggregate_key: 1, aggregate: 2 }],
      [{ id: 1, title: 'Hello' }],
      [{ aggregate_key: 1, aggregate: 2 }],
    ]);

    const builder = Post.query().withCount('comments');

    const page = await builder.paginate(10, 1);
    expect(page.data[0].getAttribute('comments_count')).toBe(2);

    const results = await builder.clone().get();
    expect(results[0].getAttribute('comments_count')).toBe(2);

    expect(queries).toHaveLength(5);
  });

  it('loads aggregates onto an existing model', async () => {
    const queries = useSelectQueue([
      [
        { id: 1, name: 'Ada' },
        { id: 2, name: 'Grace' },
      ],
      [{ aggregate_key: 1, aggregate: 4 }],
    ]);

    const users = await User.query().get();

    await users[0].loadCount('posts');

    expect(queries).toHaveLength(2);
    expect(queries[1].bindings).toEqual([1]);
    expect(users[0].getAttribute('posts_count')).toBe(4);
    expect(users[1].getAttribute('posts_count')).toBeUndefined();
  });

  it('loads aggregates onto a whole collection with a single query', async () => {
    const queries = useSelectQueue([
      [
        { id: 1, name: 'Ada' },
        { id: 2, name: 'Grace' },
      ],
      [
        { aggregate_key: 1, aggregate: 3 },
        { aggregate_key: 2, aggregate: 1 },
      ],
    ]);

    const users = await User.query().get();
    const collection = new EnsembleCollection(users);

    await collection.loadCount('posts');

    expect(queries).toHaveLength(2);
    expect(users[0].getAttribute('posts_count')).toBe(3);
    expect(users[1].getAttribute('posts_count')).toBe(1);
  });

  it('asks the database nothing for an empty collection', async () => {
    const queries = useSelectQueue([[{ id: 1, name: 'Ada' }], [{ aggregate_key: 1, aggregate: 3 }]]);

    const users = await User.query().get();
    const empty = new EnsembleCollection<User>([]);

    await empty.loadCount('posts');
    await users[0].loadMin('posts', 'views');

    // the parent select, then the single min for one model
    expect(queries).toHaveLength(2);
    expect(queries[1].sql).toContain('MIN("posts"."views") as aggregate');
    expect(users[0].getAttribute('posts_min_views')).toBe(3);
  });

  it('attaches sums, averages and existence flags through load helpers', async () => {
    useSelectQueue([
      [{ id: 1, name: 'Ada' }],
      [{ aggregate_key: 1, aggregate: 25 }],
      [{ aggregate_key: 1, aggregate: 2 }],
    ]);

    const [user] = await User.query().get();

    await user.loadSum('posts', 'views');
    await user.loadExists('posts');

    expect(user.getAttribute('posts_sum_views')).toBe(25);
    expect(user.getAttribute('posts_exists')).toBe(true);
  });
});
