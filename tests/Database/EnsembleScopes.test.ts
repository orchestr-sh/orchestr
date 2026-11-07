/**
 * Ensemble scope tests
 *
 * Local scopes (`scopePublished` model methods) become builder methods through
 * the proxy on EnsembleBuilder. Global scopes register per model class and
 * apply to every query entry point — get, aggregates/counts and eager loads —
 * through a single `applyScopes` path, and can be removed per query.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Scope } from '@/Database/Ensemble/Scope';
import { DatabaseManager } from '@/Database/DatabaseManager';
import { Ensemble } from '@/Database/Ensemble/Ensemble';
import { EnsembleBuilder } from '@/Database/Ensemble/EnsembleBuilder';
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
 * A recorder whose SELECT statements consume queued row sets in call order,
 * so a parent query and its eager loads can return different fixtures.
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

class Post extends Ensemble {
  static fillable: string[] = ['title', 'is_published', 'user_id'];
  protected timestamps: boolean = false;

  getTable(): string {
    return 'posts';
  }

  scopePublished(builder: EnsembleBuilder<Post>): EnsembleBuilder<Post> {
    return builder.where('is_published', '=', 1);
  }

  scopeTitle(builder: EnsembleBuilder<Post>, title: string): EnsembleBuilder<Post> {
    return builder.where('title', '=', title);
  }
}

class Article extends Ensemble {
  static fillable: string[] = ['title'];
  protected timestamps: boolean = false;

  getTable(): string {
    return 'articles';
  }

  // A scope that mutates the builder and returns nothing; the builder proxy
  // still has to hand back a chainable builder.
  scopeArchived(builder: EnsembleBuilder<Article>): void {
    builder.where('archived', '=', 1);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Ensemble local scopes', () => {
  beforeEach(() => {
    useRecorder();
  });

  it('is callable as a builder method and chains with the query builder', async () => {
    const queries = useRecorder({ select: [{ id: 1, title: 'Hello', is_published: 1 }] });

    // The scope returns the builder itself, so every call stays chainable.
    expect((Post.query() as any).published()).toBeInstanceOf(EnsembleBuilder);

    const posts = await (Post.query() as any).published().latest().get();

    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toBe('SELECT * FROM "posts" WHERE "is_published" = ? ORDER BY "created_at" DESC');
    expect(queries[0].bindings).toEqual([1]);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toBeInstanceOf(Post);
  });

  it('accepts arguments and composes with further clauses', () => {
    const builder = (Post.query() as any).title('Hello');

    expect(builder.toSql()).toBe('SELECT * FROM "posts" WHERE "title" = ?');
    expect(builder.getBindings()).toEqual(['Hello']);
  });

  it('supports scopes that return nothing', () => {
    const builder = Article.query();
    const chained = (builder as any).archived();

    expect(chained).toBe(builder);
    expect(builder.where('title', '=', 'x').toSql()).toBe(
      'SELECT * FROM "articles" WHERE "archived" = ? AND "title" = ?'
    );
  });

  it('lets real builder methods take precedence over same-named scopes', () => {
    class ScopedWhere extends Ensemble {
      static guarded: string[] = [];
      protected timestamps: boolean = false;

      getTable(): string {
        return 'scoped_where';
      }

      scopeWhere(builder: EnsembleBuilder<ScopedWhere>): void {
        builder.where('shadowed', '=', true);
      }
    }

    // `where` exists on the builder, so the scope is never consulted.
    expect(ScopedWhere.query().where('a', '=', 1).toSql()).toBe('SELECT * FROM "scoped_where" WHERE "a" = ?');
  });

  it('throws for unknown methods like a plain builder', () => {
    expect(() => (Post.query() as any).notAScopeOrMethod()).toThrow(TypeError);
  });
});

describe('Ensemble global scopes', () => {
  class PublishedScope implements Scope {
    apply(builder: EnsembleBuilder<any>): void {
      builder.where('is_published', '=', 1);
    }
  }

  class ScopedPost extends Ensemble {
    static fillable: string[] = ['title', 'is_published'];
    protected timestamps: boolean = false;

    getTable(): string {
      return 'scoped_posts';
    }
  }

  beforeEach(() => {
    ScopedPost.forgetGlobalScopes();
  });

  it('applies a Scope object to get queries', async () => {
    const queries = useRecorder({ select: [{ id: 1 }] });
    ScopedPost.addGlobalScope(new PublishedScope());

    await ScopedPost.query().get();

    expect(queries[0].sql).toBe('SELECT * FROM "scoped_posts" WHERE "is_published" = ?');
    expect(queries[0].bindings).toEqual([1]);
  });

  it('applies a closure scope registered with an explicit name', async () => {
    const queries = useRecorder({ select: [{ id: 1 }] });
    ScopedPost.addGlobalScope('tenant', (builder) => builder.where('tenant_id', '=', 5));

    await ScopedPost.query().get();

    expect(queries[0].sql).toBe('SELECT * FROM "scoped_posts" WHERE "tenant_id" = ?');
    expect(queries[0].bindings).toEqual([5]);
    expect(ScopedPost.getGlobalScopes().get('tenant')).toBeTypeOf('function');
  });

  it('registers closures under their function name when no identifier is given', () => {
    const tenantScope = (builder: EnsembleBuilder<ScopedPost>): void => {
      builder.where('tenant_id', '=', 5);
    };

    ScopedPost.withGlobalScope('team', () => {});
    ScopedPost.addGlobalScope(tenantScope);

    expect(ScopedPost.getGlobalScopes().has('tenantScope')).toBe(true);
    expect(ScopedPost.getGlobalScopes().has('team')).toBe(true);
  });

  it('keys Scope instances by class name', () => {
    ScopedPost.addGlobalScope(new PublishedScope());

    expect(ScopedPost.getGlobalScopes().has('PublishedScope')).toBe(true);
  });

  it('applies to aggregate and count queries', async () => {
    const queries = useRecorder({ select: [{ aggregate: 3 }] });
    ScopedPost.addGlobalScope(new PublishedScope());

    const count = await ScopedPost.query().where('user_id', '=', 9).count();

    expect(count).toBe(3);
    expect(queries[0].sql).toBe(
      'SELECT *, COUNT(*) as aggregate FROM "scoped_posts" WHERE "user_id" = ? AND "is_published" = ? LIMIT 1'
    );
    expect(queries[0].bindings).toEqual([9, 1]);
  });

  it('applies to eager loads on the related model', async () => {
    class ScopedUser extends Ensemble {
      static fillable: string[] = ['name'];
      protected timestamps: boolean = false;

      getTable(): string {
        return 'users';
      }

      posts() {
        return this.hasMany(ScopedPost, 'user_id');
      }
    }

    ScopedPost.addGlobalScope(new PublishedScope());
    const queries = useSelectQueue([[{ id: 1, name: 'Ada' }], [{ id: 9, user_id: 1, is_published: 1 }]]);

    const users = await ScopedUser.query().with('posts').get();

    // The users query has no scope; the posts eager load does.
    expect(queries[0].sql).toBe('SELECT * FROM "users"');
    expect(queries[1].sql).toContain('"is_published" = ?');
    expect(queries[1].sql).toContain('FROM "scoped_posts"');

    const loaded = users[0].getRelation('posts');
    expect(loaded).toHaveLength(1);
    expect(loaded[0].getAttribute('id')).toBe(9);
  });

  it('applies scopes once even when a builder is executed repeatedly', async () => {
    const queries = useRecorder({ select: [{ id: 1 }] });
    ScopedPost.addGlobalScope(new PublishedScope());

    const builder = ScopedPost.query();
    await builder.get();
    await builder.get();

    expect(queries).toHaveLength(2);
    for (const query of queries) {
      expect(query.sql.match(/"is_published"/g)).toHaveLength(1);
    }
  });

  it('inherits scopes registered on a parent class and lets children override', async () => {
    const queries = useRecorder({ select: [{ id: 1 }] });

    class ScopedBase extends Ensemble {
      protected timestamps: boolean = false;

      getTable(): string {
        return 'base';
      }
    }

    class ScopedChild extends ScopedBase {}

    ScopedBase.addGlobalScope('shared', (builder) => builder.where('from', '=', 'parent'));
    expect(ScopedChild.getGlobalScopes().has('shared')).toBe(true);

    ScopedChild.addGlobalScope('shared', (builder) => builder.where('from', '=', 'child'));
    await ScopedChild.query().get();

    expect(queries[0].sql).toBe('SELECT * FROM "base" WHERE "from" = ?');
    expect(queries[0].bindings).toEqual(['child']);
  });

  it('leaves queries unscoped when no scopes are registered', async () => {
    const queries = useRecorder({ select: [] });

    await ScopedPost.query().get();

    expect(queries[0].sql).toBe('SELECT * FROM "scoped_posts"');
  });
});

describe('Global scope removal', () => {
  class PublishedScopeImpl implements Scope {
    apply(builder: EnsembleBuilder<any>): void {
      builder.where('is_published', '=', 1);
    }
  }

  class TeamScope implements Scope {
    apply(builder: EnsembleBuilder<any>): void {
      builder.where('team_id', '=', 4);
    }
  }

  class ScopedPost extends Ensemble {
    static fillable: string[] = ['title', 'is_published', 'team_id'];
    protected timestamps: boolean = false;

    getTable(): string {
      return 'scoped_posts';
    }
  }

  let queries: ExecutedQuery[];

  beforeEach(() => {
    ScopedPost.forgetGlobalScopes();
    queries = useRecorder({ select: [{ id: 1 }] });
    ScopedPost.addGlobalScope(new PublishedScopeImpl());
    ScopedPost.addGlobalScope(new TeamScope());
  });

  it('removes one scope by identifier from the query', async () => {
    await ScopedPost.query().withoutGlobalScope('PublishedScopeImpl').get();

    expect(queries[0].sql).toBe('SELECT * FROM "scoped_posts" WHERE "team_id" = ?');
  });

  it('removes a scope via the model static shortcut', async () => {
    await ScopedPost.withoutGlobalScope('PublishedScopeImpl').get();

    expect(queries[0].sql).toBe('SELECT * FROM "scoped_posts" WHERE "team_id" = ?');
  });

  it('accepts the scope class as the removal identifier', async () => {
    await ScopedPost.query().withoutGlobalScope(PublishedScopeImpl).get();

    expect(queries[0].sql).toContain('"team_id" = ?');
    expect(queries[0].sql).not.toContain('"is_published"');
  });

  it('removes a subset when names are provided to withoutGlobalScopes', async () => {
    await ScopedPost.withoutGlobalScopes(['TeamScope']).get();

    expect(queries[0].sql).toBe('SELECT * FROM "scoped_posts" WHERE "is_published" = ?');
  });

  it('removes every scope when withoutGlobalScopes is called bare', async () => {
    await ScopedPost.query().withoutGlobalScopes().get();

    expect(queries[0].sql).toBe('SELECT * FROM "scoped_posts"');
    expect(queries[0].bindings).toEqual([]);
  });

  it('preserves the removal state when the builder is cloned', async () => {
    const builder = ScopedPost.query().withoutGlobalScope('PublishedScopeImpl');

    await builder.clone().get();

    expect(queries[0].sql).toBe('SELECT * FROM "scoped_posts" WHERE "team_id" = ?');
  });

  it('preserves already-applied scopes in a clone without re-applying them', async () => {
    const builder = ScopedPost.query();
    await builder.get();

    await builder.clone().get();

    expect(queries).toHaveLength(2);
    for (const query of queries) {
      expect(query.sql.match(/"is_published"/g)).toHaveLength(1);
      expect(query.sql.match(/"team_id"/g)).toHaveLength(1);
    }
  });

  it('keeps removals and applied state out of the source builder when cloning twice', async () => {
    const removed = ScopedPost.withoutGlobalScopes();
    const scoped = ScopedPost.query();

    await removed.clone().get();
    await scoped.clone().get();

    expect(queries[0].sql).toBe('SELECT * FROM "scoped_posts"');
    expect(queries[1].sql).toContain('"is_published" = ?');
  });
});
