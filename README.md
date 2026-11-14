# Orchestr

A 1:1 Laravel replica in TypeScript. Write elegant backend applications with ActiveRecord models (called Ensembles), relationships, query building, queues, caching, scheduling, and more - the same architecture Laravel ships, on Node.js.

Requires Node `^22.18.0 || >=24.0.0` and TypeScript `>=5`.

<details>
<summary><strong>Contents</strong></summary>

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Models (Ensembles)](#models-ensembles)
- [Querying](#querying)
- [Relationships](#relationships)
- [@DynamicRelation Decorator](#dynamicrelation-decorator)
- [Pagination](#pagination)
- [Migrations](#migrations)
- [Seeders](#seeders)
- [Model Factories](#model-factories)
- [Events and Listeners](#events-and-listeners)
- [Controllers](#controllers)
- [FormRequest Validation](#formrequest-validation)
- [Route Model Binding](#route-model-binding)
- [Routing](#routing)
- [API Resources](#api-resources)
- [Exception Handling](#exception-handling)
- [Session & CSRF Protection](#session--csrf-protection)
- [Hashing & Encryption](#hashing--encryption)
- [Signed URLs](#signed-urls)
- [Authentication](#authentication)
- [Authorization](#authorization)
- [Filesystem & File Uploads](#filesystem--file-uploads)
- [Collections, Strings & Helpers](#collections-strings--helpers)
- [Configuration & Environment](#configuration--environment)
- [Queue System](#queue-system)
- [Cache System](#cache-system)
- [Task Scheduling](#task-scheduling)
- [View System](#view-system)
- [API Reference](#api-reference)
- [Deploying](#deploying)
- [Features](#features)

</details>

## Installation

```bash
npm install @orchestr-sh/orchestr
```

`drizzle-orm` and `reflect-metadata` are regular dependencies and install with the package. Database drivers (`better-sqlite3`, `mysql2`, `postgres`) ship as optional dependencies and are auto-installed by npm; feature add-ons stay opt-in as optional peer dependencies:

```bash
npm install bcrypt        # or argon2 - for those Hash drivers
npm install @faker-js/faker  # for fake() in model factories
npm install ioredis       # for the redis queue / cache drivers
```

### CLI Setup

After installation, the `orchestr` command will be available in your project via `npx`:

```bash
# Run orchestr commands
npx orchestr make:event UserRegistered
npx orchestr make:controller UserController
npx orchestr make:migration create_users_table
npx orchestr migrate

# Or add to package.json scripts for convenience
{
  "scripts": {
    "orchestr": "orchestr"
  }
}

# Then run with npm
npm run orchestr make:event UserRegistered
```

For global installation (optional):

```bash
npm install -g @orchestr-sh/orchestr

# Now use orchestr directly
orchestr make:event UserRegistered
orchestr migrate
```

## Quick Start

```typescript
import 'reflect-metadata';
import {
  Application,
  Kernel,
  ConfigServiceProvider,
  DatabaseServiceProvider,
  RouteServiceProvider,
  Route,
} from '@orchestr-sh/orchestr';

const app = new Application(process.cwd()); // loads .env in the constructor

// Configure the database (or keep these values in config/database.ts - see Configuration & Environment)
app.register(new ConfigServiceProvider(app, {
  database: {
    default: 'sqlite',
    connections: {
      sqlite: {
        adapter: 'drizzle',
        driver: 'sqlite',
        database: './database.db',
      },
    },
  },
}));
app.register(DatabaseServiceProvider); // binds the 'db' manager
app.register(RouteServiceProvider); // binds the router and activates facades (Route, Config, DB, ...)

await app.boot();

// Define routes
Route.get('/', async (req, res) => {
  return res.json({ message: 'Welcome to Orchestr!' });
});

// Start the server
const kernel = new Kernel(app);
kernel.listen(3000);
```

## Models (Ensembles)

Ensembles are ActiveRecord models with a fluent API for querying and relationships.

```typescript
import { Ensemble } from '@orchestr-sh/orchestr';

export class User extends Ensemble {
  protected table = 'users';
  static fillable = ['name', 'email', 'password'];
  protected hidden = ['password'];
}

// Query
const users = await User.query().where('active', true).get();
const user = await User.find(1);

// Create
const user = await User.create({ name: 'John', email: 'john@example.com' });

// Update - attribute changes go through setAttribute()/fill();
// plain property writes are not tracked, so save() would have nothing to flush
user.setAttribute('name', 'Jane');
await user.save();

// Delete
await user.delete();
```

### Mass Assignment (fillable / guarded)

Ensembles protect against mass-assignment vulnerabilities the same way Laravel does. You declare which attributes are safe to fill in bulk by setting `fillable`, or which attributes are blocked by setting `guarded`.

#### Recommended: static properties

Declare `fillable` and `guarded` as `static` class properties. This is the cleanest approach because static properties exist on the class itself before any constructor runs, so the values are always available when `fill()` is called during construction.

```typescript
export class User extends Ensemble {
  static fillable = ['name', 'email', 'password'];
}

export class Post extends Ensemble {
  static guarded = ['id', 'user_id'];
}

// No constructor needed – mass assignment works immediately
const user = await User.create({ name: 'Alice', email: 'alice@example.com' });
```

Setting `static guarded = []` makes all attributes mass-assignable (equivalent to Laravel's "unguarded" model):

```typescript
export class LogEntry extends Ensemble {
  static guarded = [];
}
```

#### Legacy / fallback: instance properties

Before static properties were supported, the workaround was to declare `protected fillable` as an instance field initialiser and then call `this.fill()` manually in the constructor after `super()` had already run:

```typescript
// Only needed if you cannot use static properties for some reason.
export class User extends Ensemble {
  protected fillable = ['name', 'email', 'password'];

  constructor(attributes: Record<string, any> = {}, fromDatabase = false) {
    super({}, fromDatabase); // pass empty attrs to super so fill() runs before fillable is set
    this.fill(attributes);   // re-run fill now that this.fillable is initialised
  }
}
```

This pattern still works but is more verbose. Prefer `static fillable` / `static guarded` for all new models.

#### How resolution works

When `isFillable()` is called, the lookup order is:

1. **`static fillable` on the concrete class** — checked first via `Object.prototype.hasOwnProperty`. If the subclass has defined its own static property it is used as the authoritative allow-list.
2. **`this.fillable` (instance property)** — the fallback for models that use the constructor-override pattern or that inherit the base class default (`[]`).

The same two-step lookup applies to `guarded`. Models that define neither property behave identically to before: the base-class default of `guarded = ['*']` blocks all mass assignment.

### Observers

Observers group model event listeners into a single class, like Laravel's Eloquent observers. Each lifecycle hook (`creating`, `created`, `updating`, `updated`, `saving`, `saved`, `deleting`, `deleted`, `retrieved`, `restoring`, `restored`, `forceDeleting`, `forceDeleted`) runs when present on the observer. Halting events abort the operation when a hook returns `false`.

```typescript
import { Ensemble, ObservedBy } from '@orchestr-sh/orchestr';

class UserObserver {
  creating(user: Ensemble) {
    // runs before the insert; return false to halt it
  }

  saved(user: Ensemble) {
    // runs after every successful save
  }
}

// Register imperatively…
User.observe(UserObserver);

// …or declaratively with the class decorator
@ObservedBy(UserObserver)
class DecoratedUser extends Ensemble {}
```

Observers are registered per model class and inherit down to subclasses. They fire through the same model-event path as the global dispatcher, so `Event.listen(ModelSaved, …)` keeps working alongside them.

### Scopes

**Local scopes** are `scope*` methods on the model. The Ensemble query builder resolves unknown method calls to them, so they chain like any other builder call:

```typescript
class Post extends Ensemble {
  scopePublished(builder) {
    builder.where('is_published', '=', 1);
  }
}

const posts = await Post.query().published().latest().get();
```

**Global scopes** apply automatically to every query for the model — selects, aggregates/counts and eager loads:

```typescript
import type { Scope, EnsembleBuilder, Ensemble } from '@orchestr-sh/orchestr';

class PublishedScope implements Scope {
  apply(builder: EnsembleBuilder<any>, model: Ensemble): void {
    builder.where('is_published', '=', 1);
  }
}

Post.addGlobalScope(new PublishedScope());
Post.addGlobalScope('tenant', (builder) => builder.where('tenant_id', '=', 5));

// Opt out per query:
await Post.withoutGlobalScope('PublishedScope').get();
await Post.query().withoutGlobalScopes().get(); // remove all
```

### Soft Deletes

Models that should survive deletion opt in with `static softDeletes`. `delete()` then stamps the `deleted_at` column instead of removing the row, and a `SoftDeletingScope` registered on the model keeps trashed rows out of every query — selects, aggregates, eager loads and relationship queries alike. The column is always cast to a `Date`, and a soft delete touches `updated_at` when the model timestamps.

```typescript
import { SoftDeletingScope } from '@orchestr-sh/orchestr';

class User extends Ensemble {
  protected static softDeletes = true;
  static fillable = ['name'];
}

const user = await User.find(1);
await user.delete(); // UPDATE users SET deleted_at = ... — the row stays

user.trashed(); // true
await User.query().get(); // excludes trashed rows
await User.query().withTrashed().get(); // includes them
await User.query().onlyTrashed().get(); // only trashed rows
await User.query().withTrashed().withoutTrashed().get(); // exclude again

await user.restore(); // clears deleted_at; the user is visible again
await user.forceDelete(); // hard DELETE, removes the row

// Builder-wide operations
await User.query().restore(); // clear deleted_at on all matching trashed rows
await User.query().onlyTrashed().forceDelete(); // purge trashed rows
await User.query().forceDelete(); // purge every matching row, trashed or not

// Eager loads respect the scope too; opt relations into trashed rows:
await User.query().withTrashedRelations().with('posts.comments').get();
```

The scope can also be removed like any global scope, e.g. `User.query().withoutGlobalScope(SoftDeletingScope)`, and models expose `getDeletedAtColumn()` / `getQualifiedDeletedAtColumn()` for custom column names via `protected static DELETED_AT`. Soft deletes fire the `deleting`, `softDeleting`, `softDeleted`, `deleted`, `restoring`, `restored`, `forceDeleting` and `forceDeleted` hooks, so observers and listeners can react to or halt each phase. Models without the flag keep plain hard-delete behaviour.

## Querying

Fluent query builder with chainable methods.

```typescript
import { DB } from '@orchestr-sh/orchestr';

// Query builder
const users = await DB.table('users')
  .where('votes', '>', 100)
  .orderBy('created_at', 'desc')
  .limit(10)
  .get();

// Using models
const posts = await Post.query()
  .where('published', true)
  .with('author')
  .get();

// Aggregates
const count = await Post.query().count();
const avg = await Post.query().avg('views');
```

Both builders resolve `get()` to plain arrays (of rows or models) - wrap results in `collect(...)` for the fluent `Collection` API, and see [Pagination](#pagination) for `paginate()` / `cursorPaginate()` on the Ensemble builder.

## Relationships

### Standard Relationships

```typescript
import { Ensemble, HasMany, BelongsTo, DynamicRelation } from '@orchestr-sh/orchestr';

export class User extends Ensemble {
  protected table = 'users';

  @DynamicRelation
  posts(): HasMany<Post, User> {
    return this.hasMany(Post);
  }
}

export class Post extends Ensemble {
  protected table = 'posts';

  @DynamicRelation
  user(): BelongsTo<User, this> {
    return this.belongsTo(User);
  }
}

// Use relationships
const user = await User.find(1);
const posts = await user.posts().get(); // Query builder
const posts = await user.posts; // Direct access (via @DynamicRelation)

// Eager loading
const users = await User.query().with('posts').get();

// Nested eager loading
const posts = await Post.query().with('user.posts').get();
```

### Many-to-Many

```typescript
import { Ensemble, BelongsToMany, DynamicRelation } from '@orchestr-sh/orchestr';

export class User extends Ensemble {
  @DynamicRelation
  roles(): BelongsToMany<Role, User> {
    return this.belongsToMany(Role, 'role_user')
      .withPivot('expires_at')
      .withTimestamps();
  }
}

// Attach/Detach
await user.roles().attach([1, 2, 3]);
await user.roles().detach([1]);

// Sync (detach all, attach new)
await user.roles().sync([1, 2, 3]);

// Query pivot
const activeRoles = await user.roles()
  .wherePivot('expires_at', '>', new Date())
  .get();
```

### Polymorphic Relationships

```typescript
import { Ensemble, MorphMany, MorphTo, DynamicRelation } from '@orchestr-sh/orchestr';

export class Post extends Ensemble {
  @DynamicRelation
  comments(): MorphMany<Comment, Post> {
    return this.morphMany(Comment, 'commentable');
  }
}

export class Video extends Ensemble {
  @DynamicRelation
  comments(): MorphMany<Comment, Video> {
    return this.morphMany(Comment, 'commentable');
  }
}

export class Comment extends Ensemble {
  @DynamicRelation
  commentable(): MorphTo<Post | Video> {
    return this.morphTo('commentable');
  }
}

// Use polymorphic relations
const post = await Post.find(1);
const comments = await post.comments;

const comment = await Comment.find(1);
const parent = await comment.commentable; // Returns Post or Video
```

### Relationship Existence Queries

Filter by whether a relation has rows, the way Eloquent's `has` family does. Each
condition runs as a correlated sub-select, so a filtered query is still one
statement however many rows it matches:

```typescript
// Only posts that have at least one comment
const posts = await Post.query().has('comments').get();

// Count conditions: >=, =, < with any number of rows (a bare number means `>= n`)
const popular = await Post.query().has('comments', '>=', 5).get();
const commented = await Post.query().has('comments', 2).get(); // two or more
const single = await Post.query().has('comments', '=', 1).get(); // exactly one

// Invert it
const silent = await Post.query().doesntHave('comments').get();

// Constrain the related query with a callback
const reviewed = await Post.query()
  .whereHas('comments', (query) => query.where('approved', true))
  .get();

// ...or by a plain column, without writing the closure
const approved = await Post.query().whereRelation('comments', 'approved', true).get();

// OR variants
await Post.query().where('title', '=', 'Hello').orHas('comments').get();
await Post.query().where('title', '=', 'Hello').orWhereHas('comments', (q) => q.where('spam', false)).get();
await Post.query().where('title', '=', 'Hello').orDoesntHave('comments').get();
await Post.query().where('title', '=', 'Hello').orWhereDoesntHave('comments').get();

// Nested paths nest one sub-select per step: users with posts that have comments
const chatty = await User.query().whereHas('posts.comments').get();
const quiet = await User.query().whereDoesntHave('posts.comments').get();

// Inverse relations by the related model itself
const mine = await Post.query().whereBelongsTo(user).get();
const ours = await Post.query().whereBelongsTo([user, teammate]).get();
```

`whereBelongsTo` takes a model or a list of models (or an `EnsembleCollection`),
resolves the relationship from the related class name, and compares the parent's
foreign key with the owner keys. Existence checks exclude soft-deleted related
rows and apply the related model's global scopes; `withTrashedRelations()` opts
those sub-selects back in.

A polymorphic inverse relation (`morphTo`) picks its table from each row's type
column, so it has no single sub-select to correlate and throws instead of
guessing. The same applies to relations whose parent and child share one table:
inside a correlated sub-select the alias the outer row needs does not exist yet.
Aggregates are unaffected by that, since they group by a key instead of
correlating.

### Relationship Aggregates

`withCount` and friends add one grouped query per relation and write the result
onto every model, so a page of a hundred models still costs one select:

```typescript
const posts = await Post.query().withCount('comments').get();
posts[0].getAttribute('comments_count'); // 12

// Column aggregates are named after relation, function and column
await Post.query().withSum('comments', 'votes').get(); // comments_sum_votes
await Post.query().withAvg('comments', 'votes').get(); // comments_avg_votes
await Post.query().withMin('comments', 'votes').get(); // comments_min_votes
await Post.query().withMax('comments', 'votes').get(); // comments_max_votes

// Existence as a boolean
await Post.query().withExists('comments').get(); // comments_exists: true | false

// Several relations at once
await User.query().withCount(['posts', 'comments']).get();

// Aliases, either in the name or as the value of the map
await Post.query().withCount('comments as total_comments').get();
await Post.query().withCount({ comments: 'total_comments' }).get();

// Constrain what is aggregated
await Post.query()
  .withCount({ 'comments as approved_count': (query) => query.where('approved', true) })
  .get();

// And on models or collections you already have, without a query per model
await post.loadCount('comments');
await post.loadSum('comments', 'votes');

const users = new EnsembleCollection(await User.query().get());
await users.loadCount(['posts', 'comments']); // one query per relation, not per user
```

Counts attach `0`, existence flags `false` and the column aggregates `null` when a
relation has no rows. Values land as ordinary attributes (`toObject()` includes
them) without marking the model dirty, so a later `save()` never tries to write a
computed column. Aggregates respect the related model's soft-delete scope and
global scopes; `withTrashedRelations()` lifts the soft-delete exclusion just as it
does for eager loads.

## @DynamicRelation Decorator

The `@DynamicRelation` decorator enables dual-mode access to relationships:

```typescript
export class User extends Ensemble {
  @DynamicRelation
  posts(): HasMany<Post, User> {
    return this.hasMany(Post);
  }
}

const user = await User.find(1);

// Method syntax (returns query builder)
const query = user.posts();
const recentPosts = await query.where('created_at', '>', yesterday).get();

// Property syntax (returns results directly)
const allPosts = await user.posts;
```

Without `@DynamicRelation`, you must always call the method: `user.posts().get()`.

## Pagination

Paginators live on the Ensemble query builder (`DB.table(...)` has only `forPage(offset, limit)`). Note the argument order: page comes second, and everything Laravel would pull from the current request is passed explicitly through an options object.

```typescript
// paginate(perPage = 15, page = 1, columns = ['*'], options: { path, query, pageName, fragment, onEachSide })
const page = await Post.query().orderBy('id').paginate(15, 2, ['*'], { path: '/posts' });

page.items; // Collection<Post> of the current window
page.total; // 47 - a COUNT(*) runs alongside (skipped entirely when there is nothing to count)
page.lastPage;
page.currentPage;
page.hasMorePages();
page.nextPageUrl(); // '/posts?page=3'
page.links(); // [{ url: '/posts?page=1', label: '&laquo; Previous', active: false }, ..., spacer entries with url: null]
page.appends({ sort: 'title' }); // keep extra query params on every generated link
```

- `paginate(perPage?, page?, columns?, options?)` returns a `LengthAwarePaginator` - total, last page, numbered links.
- `simplePaginate(perPage?, page?, columns?, options?)` returns a `Paginator` - one `LIMIT perPage + 1` query, no count, previous/next links only.
- `cursorPaginate(perPage?, cursor?, columns?, options?)` returns a `CursorPaginator` - stable keyset pagination; pass the `nextCursor()`/`previousCursor()` value (or the raw `?cursor=` string from a request) to walk forward or back. Ordering falls back to the model's primary key when the query has none.

Every paginator serialises to the Laravel-shaped JSON keys through `toArray()`/`toJson()`, so returning one from a route handler just works:

```typescript
// Length-aware: current_page, data, first_page_url, from, last_page, last_page_url,
// links, next_page_url, path, per_page, prev_page_url, to, total
Route.get('/posts', async () => Post.query().paginate(15));
```

```typescript
// Simple: no totals - current_page, data, from, to, next_page_url, prev_page_url, ...
const page = await Post.query().simplePaginate(15);

// Cursor: data, links: { first, last, prev, next }, path, per_page - walk it like:
let cursor = null;
const titles: string[] = [];
do {
  const page = await Post.query().orderBy('created_at').cursorPaginate(4, cursor);
  titles.push(...page.data.map((post) => post.getAttribute('title')));
  cursor = page.nextCursor();
} while (cursor !== null);
```

Cursors are base64url-encoded JSON carrying the point's column values, the ordering index, and travel direction; malformed or stale cursors throw `InvalidCursorException`. Set the query-string name with `{ cursorName: 'after' }`.

Link generation has no ambient request object - register a resolver once and all paginators pick up the current path and query string (otherwise they fall back to `/`):

```typescript
import { resolveCurrentRequestUsing } from '@orchestr-sh/orchestr';

resolveCurrentRequestUsing(() => ({
  path: '/posts',
  query: { filter: 'active' },
}));

const page = await Post.query().paginate(10);
page.nextPageUrl(); // '/posts?filter=active&page=2'
page.withQueryString(); // opt into the live request query on generated links
```

The paginator classes (`LengthAwarePaginator`, `Paginator`, `CursorPaginator`, `Cursor`, `UrlWindow`) are exported and directly constructible when you need to paginate a plain array or a hand-built result set.

## Migrations

Laravel-style migrations with a fluent Schema builder.

```bash
# Create a migration (bare stub; --create makes a Schema::create stub, --table makes a Schema::table stub)
npx orchestr make:migration create_users_table --create --table=users

# Run migrations
npx orchestr migrate

# Run each migration in its own batch, so it can be rolled back on its own
npx orchestr migrate --step

# Seed the database once the migrations have run
npx orchestr migrate --seed

# Run migrations against a production database
npx orchestr migrate --force

# Preview the SQL without touching the database
npx orchestr migrate --pretend

# Create only the migrations tracking table
npx orchestr migrate:install

# Rollback last batch
npx orchestr migrate:rollback

# Rollback all migrations
npx orchestr migrate:reset

# Drop all tables and re-run migrations (fresh start)
npx orchestr migrate:fresh

# Rollback and re-run all migrations (uses migration tracking)
npx orchestr migrate:refresh

# Check migration status
npx orchestr migrate:status
```

> **Note:** `migrate:fresh` drops all tables in the database and re-runs all migrations from scratch, giving you a completely clean slate. Use this for development/testing when you want to start over. `migrate:refresh` is more conservative—it only rolls back and re-runs migrations that the framework knows about. `migrate:reset` rolls back migrations without re-running them.

### Creating Tables

```typescript
import { Migration, Schema } from '@orchestr-sh/orchestr';

export default class extends Migration {
  async up(schema: Schema): Promise<void> {
    await schema.create('users', (table) => {
      table.id();
      table.string('name');
      table.string('email').unique();
      table.string('password');
      table.rememberToken();
      table.timestamps();
    });
  }

  async down(schema: Schema): Promise<void> {
    await schema.dropIfExists('users');
  }
}
```

### Column Types

```typescript
table.id()                          // Auto-incrementing big integer primary key
table.increments('id')              // Auto-incrementing integer primary key
table.bigIncrements('id')           // Auto-incrementing big integer primary key
table.string('name', 255)           // VARCHAR
table.text('bio')                   // TEXT
table.integer('votes')              // INTEGER
table.bigInteger('amount')          // BIGINT
table.unsignedBigInteger('user_id') // UNSIGNED BIGINT
table.decimal('price', 8, 2)        // DECIMAL
table.boolean('active')             // BOOLEAN
table.date('birth_date')            // DATE
table.datetime('published_at')      // DATETIME
table.timestamp('created_at')       // TIMESTAMP
table.timestamps()                  // created_at & updated_at
table.json('metadata')              // JSON
table.uuid('identifier')            // UUID
table.ulid('sort_key')              // CHAR(26) / VARCHAR(26)
table.enum('status', ['draft', 'published'])
```

### Column Modifiers

```typescript
table.string('email').nullable()
table.string('email').unique()
table.string('email').default('guest@example.com')
table.integer('votes').unsigned()
table.string('email').index()
table.integer('votes').default(0)
table.timestamp('created_at').default(raw('CURRENT_TIMESTAMP'))
```

Default values are escaped by the grammar, so a value containing a quote is safe.
Raw SQL is only emitted when it is explicitly wrapped: `raw('CURRENT_TIMESTAMP')`.

### Foreign Keys

```typescript
// Declare the column and its constraint in one step.
table.foreignId('user_id').constrained().cascadeOnDelete();

// Or point it at a model: creates `user_id` referencing `users.id`.
table.foreignIdFor(User);

// The long form still works.
table.bigInteger('user_id').unsigned();
table.foreign('user_id').references('id').on('users').onDelete('cascade');
```

### Polymorphic Columns

```typescript
table.morphs('commentable');        // commentable_type + commentable_id
table.nullableMorphs('authorable'); // the same pair, nullable
```

### Modifying and Dropping Things

```typescript
await schema.table('users', (table) => {
  table.string('name', 100).nullable().change();  // redefine a column
  table.renameColumn('login', 'username');
  table.dropColumn('tmp');
  table.dropIndex(['name']);                     // or dropIndex('users_name_index')
  table.dropUnique(['email']);
  table.dropForeign(['user_id']);
  table.dropPrimary();
  table.renameIndex('users_name_index', 'users_handle_index');
  table.dropTimestamps();
  table.dropSoftDeletes();
});
```

`change()` compiles wherever the driver supports redefining a column in place
(PostgreSQL). Elsewhere it fails with a clear error rather than emitting SQL the
driver would reject, as do dropping a primary key or a foreign key on SQLite.

### Switching Foreign Keys Off

```typescript
await schema.withoutForeignKeyConstraints(async () => {
  await schema.dropIfExists('posts');
  await schema.dropIfExists('users');
});
```

Constraints are restored even if the callback throws. Dialects without a session
switch (PostgreSQL) simply run the statements, which is why a PostgreSQL
`DROP TABLE` cascades.

### Per-driver Grammars

Every dialect decision - column types, auto-increment syntax, default literals,
identifier quoting, index and foreign key placement, and the catalog queries
behind `hasTable()`/`hasColumn()` - lives in a schema grammar
(`SqliteSchemaGrammar`, `PostgresSchemaGrammar`, `MySqlSchemaGrammar`), resolved
from the connection's configured driver. Adding a driver means adding a grammar,
not editing the builder.

## Seeders

Populate your database with test or initial data.

```bash
# Create a seeder
npx orchestr make:seeder UserSeeder

# Run all seeders (runs DatabaseSeeder)
npx orchestr db:seed

# Run a specific seeder
npx orchestr db:seed --class=UserSeeder
```

### Creating Seeders

```typescript
import { Seeder } from '@orchestr-sh/orchestr';

export default class UserSeeder extends Seeder {
  async run(): Promise<void> {
    await this.connection?.table('users').insert([
      { name: 'John Doe', email: 'john@example.com' },
      { name: 'Jane Smith', email: 'jane@example.com' },
    ]);
  }
}
```

### DatabaseSeeder Pattern

```typescript
import { Seeder } from '@orchestr-sh/orchestr';
import UserSeeder from './UserSeeder';
import PostSeeder from './PostSeeder';

export default class DatabaseSeeder extends Seeder {
  async run(): Promise<void> {
    await this.call(UserSeeder);
    await this.call(PostSeeder);

    // Or call multiple seeders at once
    await this.callMany([UserSeeder, PostSeeder]);
  }
}
```

## Model Factories

Factories generate model attributes for tests and seeders so you never hand-build records again. A factory is a class extending `Factory<TModel>` with a `definition()` method; `registerFactory(UserFactory)` pairs the model and factory by convention (`User` -> `UserFactory`), which lets every model call `User.factory()`.

```typescript
import { Ensemble, Factory, fake, registerFactory } from '@orchestr-sh/orchestr';

export class User extends Ensemble {
  static fillable = ['name', 'email'];

  posts() {
    return this.hasMany(Post, 'user_id');
  }
}

export class UserFactory extends Factory<User> {
  static model = User;

  definition() {
    return {
      name: fake('name.fullName'),
      email: fake('internet.email'),
    };
  }

  // State transformations, callable like admin()
  admin() {
    return this.state({ admin: true });
  }
}

registerFactory(UserFactory);
```

### Creating Models

```typescript
const user = await User.factory().make(); // unsaved model with generated attributes
await User.factory().create(); // persisted model
const users = await User.factory().count(3).create(); // three persisted models

await User.factory().state({ admin: true }).create(); // state override
await User.factory().make({ name: 'Ada' }); // attributes passed inline
await User.factory().admin().create(); // named state method

// Sequences cycle values deterministically, one per record
await User.factory()
  .count(4)
  .sequence([{ admin: true }, { admin: false }])
  .create();

// Plain attribute records, no model instances
const attributes = await User.factory().raw();

// Bulk helpers
await User.factory().makeMany(2); // two unsaved models
await User.factory().createMany([{ name: 'A' }, { name: 'B' }]); // per-record states

// Global helper, same resolution convention
await factory(User, 3).create();

// Models whose factory breaks the convention override newFactory()
class Page extends Ensemble {
  static newFactory() {
    return new CustomPageFactory();
  }
}
```

Mass assignment protection is disabled for factory-built attributes, just like Laravel.

### Relationships

```typescript
// has() creates children around each parent (Post -> posts guessed by convention)
const user = await User.factory().has(Post.factory().count(2)).create();

// Explicit count and relationship name also supported
await User.factory().has(Post.factory(), 3, 'posts').create();

// for() wires the child to a belongsTo parent...
const posts = await Post.factory().count(3).for(User.factory().state({ name: 'Jessica' })).create();

// ...including existing model instances, shared across all records
const posts = await Post.factory().count(3).for(existingUser).create();

// Relationship factories can also be embedded in definitions
class PostFactory extends Factory<Post> {
  static model = Post;

  definition() {
    return {
      user_id: User.factory(), // created, its key stored in user_id
      title: fake('lorem.sentence'),
    };
  }
}
```

### Callbacks

```typescript
class UserFactory extends Factory<User> {
  static model = User;

  configure(): this {
    return this
      .afterMaking((user) => {
        /* runs on built models, before saving */
      })
      .afterCreating(async (user) => {
        /* runs after the user (and its has() children) are persisted */
      });
  }
}

// Global hooks for every factory, optionally scoped to one model class
Factory.configure((config) => {
  config.afterCreating((user) => audit(user), User);
});
```

### Faker

`fake()` reads from `@faker-js/faker`, an **optional peer dependency**:

```bash
npm install @faker-js/faker --save-dev
```

Factories load the generator automatically before evaluating a definition. Definitions that never call `fake()` work without the package installed, and calling `fake()` without it throws a clear installation message rather than returning random data. Use `await Fake.load()` when calling `fake()` outside of a factory.

For deterministic tests without Faker - or with a pinned seed - substitute a provider behind the `Fake` adapter:

```typescript
Fake.use({
  name: { fullName: () => 'Ada Lovelace' },
  internet: { email: () => 'ada@example.com' },
});

// With real Faker installed:
Fake.seed(1234);
await Fake.load();
```

## Events and Listeners

Laravel-style event system with async-aware dispatch, queued listeners,
subscribers, and automatic discovery.

### Creating Events

Events are simple classes that hold data about something that happened in your application.

```typescript
import { Event } from '@orchestr-sh/orchestr';

export class UserRegistered extends Event {
  constructor(public readonly user: User) {
    super();
  }
}

// Create via command
npx orchestr make:event UserRegistered
```

### Creating Listeners

Listeners handle events with a `handle` method. Async listeners are fully
supported - the dispatcher awaits each one in registration order.

```typescript
export class SendWelcomeEmail {
  handle(event: UserRegistered): void {
    // Send welcome email to event.user
  }
}

// Create via command
npx orchestr make:listener SendWelcomeEmail --event=UserRegistered
npx orchestr make:listener ProcessOrder --queued  // For queued listeners
```

### Registering Events and Listeners

Register in your `EventServiceProvider`:

```typescript
import { EventServiceProvider } from '@orchestr-sh/orchestr';

export class AppEventServiceProvider extends EventServiceProvider {
  protected listen = {
    'UserRegistered': [
      'SendWelcomeEmail',
      'CreateUserProfile',
    ],
    'OrderPlaced': 'SendOrderConfirmation',
  };
}
```

Or use the Event facade to register listeners dynamically. Note the two `Event` names: the **base class** for your event definitions comes from the main entry, while `listen`/`dispatch`/`fake`/assertions live on the **facade** (here aliased as `Event`):

```typescript
import { EventFacade as Event } from '@orchestr-sh/orchestr';
// ...or equivalently: import { Event } from '@orchestr-sh/orchestr/Facades';

// Class-based listener
Event.listen(UserRegistered, SendWelcomeEmail);

// Closure listener
Event.listen(UserRegistered, (event) => {
  console.log(`User registered: ${event.user.email}`);
});

// Multiple events
Event.listen(['UserRegistered', 'UserUpdated'], LogUserActivity);

// Wildcard listeners
Event.listen('user.*', (event) => {
  // Handles user.registered, user.updated, etc.
});

// Queued listener - pushed to the queue instead of running inline
Event.listen(UserRegistered, SendWelcomeEmail, true);
```

### Dispatching Events

`dispatch()` and `until()` are async: every listener is awaited in
registration order (direct listeners first, then wildcard listeners) before
the returned promise resolves.

```typescript
import { EventFacade as Event } from '@orchestr-sh/orchestr';

// Dispatch via facade
await Event.dispatch(new UserRegistered(user));

// Static dispatch on the event class itself (from the Dispatchable mixin)
await UserRegistered.dispatch(user);
// Beware: Event.dispatch on the abstract base class would construct a bare
// Event - always dispatch your concrete subclass, via the facade or
// ConcreteEvent.dispatch(...).

// Conditional dispatch
await UserRegistered.dispatchIf(user.isActive, user);
await UserRegistered.dispatchUnless(user.isAdmin, user);

// Dispatch until first non-null response (halting)
const result = await UserRegistered.until(user);
if (result === false) {
  // Listener vetoed the operation
}

// Queue events for later
Event.push('user.registered', [user]);
await Event.flush('user.registered'); // Dispatch all queued
```

### Queued Listeners

Listeners marked with the `ShouldQueue` contract - or registered with the
third `queued` argument - are pushed onto the queue as `CallQueuedListener`
jobs instead of running inline. The event and listener class name are
serialized into the job payload and restored by the worker. Because
TypeScript erases interfaces, mark the listener at runtime (the `queued`
property, or queue configuration properties like `queue`/`tries`):

```typescript
import { ShouldQueue } from '@orchestr-sh/orchestr';

export class SendWelcomeEmail implements ShouldQueue {
  public readonly queued = true; // runtime marker for the dispatcher
  public connection = 'redis';   // optional queue configuration
  public queue = 'emails';
  public tries = 3;

  async handle(event: UserRegistered): Promise<void> {
    // Runs inside a queue worker, not the request
  }
}
```

Queued listeners contribute no inline response: they never halt a halting
dispatch and `until()` skips them.

### Dispatching After Commit

Events implementing `ShouldDispatchAfterCommit` (carrying the runtime marker
property) wait for the active database transaction to commit before their
listeners run. Queued listeners can opt in to the same behavior with
`ShouldQueueAfterCommit` (`queued` + `afterCommit` markers) so the job is
only pushed once the data behind it is durable:

```typescript
class UserRegistered extends Event implements ShouldDispatchAfterCommit {
  public readonly shouldDispatchAfterCommit = true;
}

// Inside a connection transaction - DB.connection().transaction(async (trx) => { ... }):
// nothing fires until commit(), and a rollback discards the deferred dispatch entirely.
await UserRegistered.dispatch(user);
```

### Event Subscribers

Subscribers listen to multiple events in a single class:

```typescript
import { Dispatcher, type EventSubscriber } from '@orchestr-sh/orchestr';

export class UserEventSubscriber implements EventSubscriber {
  subscribe(events: Dispatcher): void {
    events.listen('UserRegistered', this.onRegistered.bind(this));
    events.listen('UserUpdated', this.onUpdated.bind(this));
    events.listen('user.*', this.logActivity.bind(this));
  }

  onRegistered(event: UserRegistered): void {
    // Handle registration
  }

  onUpdated(event: UserUpdated): void {
    // Handle update
  }

  logActivity(event: any): void {
    // Log any user activity
  }
}

// Register in EventServiceProvider
protected subscribe = [
  'UserEventSubscriber',
];
```

### Model Events

Ensemble models automatically dispatch lifecycle events. `save()`, `delete()`,
`restore()`, and `forceDelete()` await the dispatcher, so async listeners
complete - and a `false` response halts the operation - before the lifecycle
continues:

```typescript
import { EventFacade as Event, ModelCreated, ModelDeleting } from '@orchestr-sh/orchestr';

// Listen to model events
Event.listen(ModelCreated, (event) => {
  console.log('Model created:', event.model);
});

Event.listen(ModelDeleting, (event) => {
  // Prevent deletion by returning false
  if (event.model.getAttribute('isProtected')) {
    return false;
  }
});

// Wildcards work on the dispatched event NAME. Model events all dispatch
// under their class names (ModelSaved, ModelDeleting, ...), so 'Model*'
// catches every model's lifecycle; discriminate per model in the listener:
Event.listen('Model*', (event) => {
  if (event.model instanceof User) {
    // ...only User lifecycle events
  }
});
```

Available model events:
- `ModelRetrieved` - After a model is retrieved from database
- `ModelCreating` - Before a model is created (can halt)
- `ModelCreated` - After a model is created
- `ModelUpdating` - Before a model is updated (can halt)
- `ModelUpdated` - After a model is updated
- `ModelSaving` - Before a model is saved (can halt)
- `ModelSaved` - After a model is saved
- `ModelDeleting` - Before a model is deleted (can halt)
- `ModelDeleted` - After a model is deleted
- `ModelSoftDeleting` / `ModelSoftDeleted` - Around a soft delete (soft-deleting models)
- `ModelRestoring` / `ModelRestored` - Before (can halt) / after a trashed model is restored
- `ModelForceDeleting` / `ModelForceDeleted` - Before (can halt) / after a hard delete

All of these fire. The core `Model*` classes are exported from `@orchestr-sh/orchestr`; every event above can additionally be matched by its name string, e.g. `Event.listen('ModelRestored', ...)` - or handled through observer hooks (`restoring`, `restored`, `forceDeleting`, `forceDeleted`), which cover them all.

### Testing Events

Use `Event.fake()` to test event dispatching. The fake mirrors the async
dispatcher, so await your code under test as usual; no listener ever runs:

```typescript
import { EventFacade as Event } from '@orchestr-sh/orchestr';

// Fake all events
Event.fake();

// Your code that dispatches events
await userService.register(userData);

// Assert events were dispatched
Event.assertDispatched(UserRegistered);
Event.assertDispatched(UserRegistered, (event) => {
  return event.user.email === 'test@example.com';
});
Event.assertDispatchedTimes(UserRegistered, 2);
Event.assertNotDispatched(UserDeleted);
Event.assertNothingDispatched();

// Fake specific events only
Event.fake([UserRegistered, OrderPlaced]);

// Fake all except specific events
Event.fakeExcept([UserDeleted]);

// Scoped faking
const [result, fake] = await Event.fakeFor(async (fake) => {
  await someService.createUser();
  return 'done';
});
fake.assertDispatched(UserRegistered);

// Queued-listener assertions: record which dispatches the real dispatcher
// would have routed to the queue
const fake = Event.fake();
fake.listen(UserRegistered, SendWelcomeEmail, true);
await UserRegistered.dispatch(user);
fake.assertDispatchedToQueue(UserRegistered);
fake.assertNotDispatchedToQueue(UserDeleted);
```

### Console Commands

```bash
# Create event
orchestr make:event UserRegistered
orchestr make:event OrderPlaced

# Create listener
orchestr make:listener SendWelcomeEmail
orchestr make:listener SendWelcomeEmail --event=UserRegistered
orchestr make:listener ProcessOrder --queued

# Create controller
orchestr make:controller UserController
orchestr make:controller Api/UserController --path=app/Http/Controllers

# Create a model with its matching migration, factory, and seeder
orchestr make:model Post --migration --factory --seed

# Create the everyday artefacts; existing files are kept unless --force
orchestr make:request StorePostRequest
orchestr make:policy PostPolicy --model=Post
orchestr make:resource PostResource
```

## Console Kernel

Commands use Laravel-style signatures parsed into arguments and options by the kernel:

```typescript
import { Command, CommandOptions } from '@orchestr-sh/orchestr';

export class MakeModelCommand extends Command {
  signature = 'make:model {name} {--m|migration} {--f|factory} {--all}';
  description = 'Create a new model';

  async handle(args: string[], options: CommandOptions): Promise<void> {
    const name = this.argument('name'); // or args[0]
    if (this.option('migration')) {
      // ...
    }

    this.success(`Model created: ${name}`);
    const overwrite = await this.confirm('Overwrite existing file?'); // defaults when non-interactive
  }
}
```

**Signature grammar**

| Token | Meaning |
| ----- | ------- |
| `{name}` | Required argument |
| `{name?}` | Optional argument |
| `{name=default}` | Argument with a default value |
| `{names*}` / `{names*=a,b}` | Array argument (collects remaining tokens), optional defaults |
| `{--all}` | Boolean flag (default `false`) |
| `{--m\|migration}` | Option with shortcut `-m` / `--migration` |
| `{--env=production}` | Value option with default; `{--env=}` defaults to null |
| `{name : Description}` | Description shown by `help` |

**Kernel behaviour**

- Validation: missing required arguments or stray positional arguments print an error with the usage line and exit non-zero. Undeclared `--options` keep passing through untouched.
- Global flags: `orchestr list`, `orchestr help <command>`, `--help`/`-h`, `--quiet`/`-q`, `--no-interaction`/`-n`, and `-v`/`-vv`/`-vvv` verbosity (stack traces at `-vv`).
- Discovery: commands in `app/Console/Commands` are imported at boot, instantiated through the container (so constructor injection works), and may override framework commands by name. Framework built-ins come from the manifest in `orchestr/Console/Commands`.

**Output & prompts**

Every command writes through a shared `OutputStyle` (`info`, `success`, `warning`, `error`, `comment`, `question`, `line`, `newLine`, `table`, `progress`, `spin`). Colour follows the `NO_COLOR` / `FORCE_COLOR` environment variables and falls back to plain text on non-TTY output. Prompts (`ask`, `secret`, `confirm`, `choice`, `anticipate`) are built on `node:readline` and resolve to their defaults whenever the session is non-interactive, so automation never hangs.

## Controllers

Create a new controller with the CLI:

```bash
npx orchestr make:controller UserController
npx orchestr make:controller Api/UserController --path=app/Http/Controllers  # Custom path
```

The command creates a controller class extending the base `Controller` and creates `app/Http/Controllers/Controller.ts` if it does not exist.

```typescript
import { Controller, Injectable, ValidateRequest } from '@orchestr-sh/orchestr';

@Injectable()
export class UserController extends Controller {
  constructor(private service: UserService) {
    super();
  }

  @ValidateRequest()
  async index(req: GetUsersRequest, res: any) {
    const users = await User.query().with('posts').get();
    return res.json({ data: users });
  }

  async show(req: any, res: any) {
    const user = await User.find(req.routeParam('id'));
    if (!user) return res.status(404).json({ error: 'Not found' });
    return res.json({ data: user });
  }
}

// Register route
Route.get('/users', [UserController, 'index']);
Route.get('/users/:id', [UserController, 'show']);
```

## FormRequest Validation

```typescript
import { FormRequest, ValidationRules } from '@orchestr-sh/orchestr';

export class StoreUserRequest extends FormRequest {
  protected authorize(): boolean {
    return true; // Add authorization logic
  }

  protected rules(): ValidationRules {
    return {
      name: 'required|string|min:3',
      email: 'required|email',
      password: 'required|min:8',
    };
  }
}

// Use with @ValidateRequest decorator
@Injectable()
export class UserController extends Controller {
  @ValidateRequest()
  async store(req: StoreUserRequest, res: any) {
    const validated = req.validated();
    const user = await User.create(validated);
    return res.status(201).json({ data: user });
  }
}
```

## Route Model Binding

Controller actions receive their arguments resolved by the shared `RouteResolver`
(`design:paramtypes` metadata plus parameter-name reflection). Decorate an action
with `@Action()` (or `@ValidateRequest()` when it takes a `FormRequest`) so
TypeScript emits the metadata; parameters are then resolved in any order:

- `Request` / `Response` - the current request/response objects
- `FormRequest` subclasses - instantiated and validated (422/403 responses preserved)
- Route parameters by name - raw strings, or resolved models once bound
- Ensemble models type-hinted with a matching parameter name - implicit binding
- Container-resolvable services

```typescript
import { Controller, Injectable, Action, Request, Response } from '@orchestr-sh/orchestr';

@Injectable()
export class UserController extends Controller {
  @Action()
  async show(request: Request, user: User) {
    // GET /users/1 => user is a User instance loaded by primary key
    return { name: user.getAttribute('name') };
  }
}

Route.get('/users/:user', [UserController, 'show']);
```

Missing models throw `ModelNotFoundException`, which the exception handler renders as a 404.

```typescript
// Explicit bindings
Route.bind('token', (value) => ApiToken.findByValue(value));
Route.model('page', Page); // GET /pages/:page => resolved by Page's route key

// Custom route key used by implicit binding
export class Page extends Ensemble {
  getRouteKeyName(): string {
    return 'slug';
  }
}

// Scoped bindings: constrain the child binding by its parent
Route.get('/users/:user/posts/:post', [PostController, 'show']).scopeBindings();
// ...or for a whole group
Route.group({ prefix: 'api' }, () => {
  Route.scopeBindings();
  Route.get('/users/:user/posts/:post', [PostController, 'show']);
});
```

String actions (`'UserController@show'`) resolve the controller from the container,
so `'UserController'` must be bound (e.g. `app.bind('UserController', UserController)`).
Once bound, `request.route('user')`, `request.routeParam('user')` and the matched
`route.parameters` all return the same resolved value, and `request.route()` returns
the matched `Route` instance.

## Routing

### Parameters & constraints

Parameters use the `:name` syntax. Append `?` to make a segment optional, and
constrain values with `where()` (per route) or `pattern()` (global, honoured by
routes compiled before *and* after registration):

```typescript
Route.get('/users/:id?', () => {}); // matches /users and /users/1

Route.get('/users/:id', showUser).where('id', '\\d+'); // /users/abc never matches
Route.where('id', '\\d+'); // shorthand: constrains the most recently registered route

Route.get('/pages/:slug', showPage); // Route.pattern() applies too
Route.pattern('slug', '[a-z\\-]+'); // global constraint by parameter name
```

Matching normalizes trailing slashes (`/users/` === `/users`) and bound
parameter values are URL-decoded.

### Named routes & URL generation

```typescript
const user = Route.get('/users/:id', showUser);
Route.name('users.show', user);

Route.url('users.show', { id: 1 }); // '/users/1'
Route.url('users.show', { id: 1, page: 2 }); // '/users/1?page=2' - unused params become the query string
route('users.show', { id: 1 }); // global helper, resolves the router from the container
```

Route models (anything with `getRouteKey()`) and scalars work as parameter
values too: `route('users.show', user)` or `route('users.show', 1)`. Groups can
prefix names and pin hosts; generated URLs include the domain:

```typescript
Route.group({ prefix: 'api', name: 'v1', domain: 'acme.example.com' }, () => {
  const users = Route.get('/users/:id', showUser);
  Route.name('users.show', users); // 'v1.users.show'
});

route('v1.users.show', { id: 1 }); // 'http://acme.example.com/api/users/1'
```

### Resource routes

`Route.resource()` registers the seven conventional CRUD routes
(`users.index`, `users.create`, `users.store`, `users.show`, `users.edit`,
`users.update`, `users.destroy`); `Route.apiResource()` skips `create`/`edit`:

```typescript
Route.resource('users', UserController); // /users, /users/create, /users/:user, ...
Route.apiResource('users', UserController);

Route.resource('users', UserController, { only: ['index', 'show'] });
Route.resource('users', UserController, { except: ['edit'] });
Route.resource('photos', PhotoController, { names: { index: 'thumbnails' } }); // photos.thumbnails
Route.resource('users', UserController, { parameters: { user: 'uuid' } }); // /users/:uuid

// Nested via dot notation; shallow drops the parent segments on item routes
Route.resource('users.posts', PostController); // GET /users/:user/posts/:post
Route.resource('users.posts', PostController, { shallow: true }); // GET /posts/:post
```

### View, redirect & fallback routes

```typescript
Route.view('/welcome', 'welcome', { name: 'Ada' }); // renders through the View facade
Route.redirect('/here', '/there', 301);
Route.fallback((req, res) => res.status(404).send('Page not found')); // last-resort GET|HEAD route
```

### Method handling

- A path that exists but not for the request verb answers **405** with an
  `Allow` header listing the registered verbs.
- **OPTIONS** to an existing path answers **204** with the same `Allow` header
  (register an `OPTIONS` verb explicitly to handle preflights yourself).

### Current route & request-scoped parameters

```typescript
Route.current(); // the Route instance serving the request (null outside dispatch)
Route.currentRouteName(); // its name, if any
```

Parameter binding is request-scoped: the matched registration is cloned per
dispatch, so concurrent requests to `/users/:id` each keep their own parameter
values and the shared route is never mutated.

## API Resources

Transformers shape how models appear in API responses, Laravel-style. A resource class wraps any value and maps it in `toArray()`; `X.collection(...)` wraps lists, `EnsembleCollection`s, and paginators alike.

```typescript
import { JsonResource } from '@orchestr-sh/orchestr';

class PostResource extends JsonResource {
  toArray(): Record<string, any> {
    return {
      id: this.resource.getKey(),
      title: this.resource.getAttribute('title'),
      author: this.whenLoaded('author'), // included only when the relation was eager-loaded
      comments_count: this.whenCounted('comments'), // only when withCount('comments') ran
      ...this.mergeWhen(this.resource.getAttribute('published'), { published_at: 'now' }),
    };
  }
}

Route.get('/posts', async () => PostResource.collection(await Post.query().with('author').get()));
Route.get('/posts/page', async () => PostResource.collection(Post.query().paginate(15)));
```

- Responses are `data`-wrapped by default. Change the key per class with `protected static wrap = 'post'`, turn wrapping off per instance with `->withoutWrapping()`, or per class with `PostResource.withoutWrapping()`.
- `->with({ extra: 1 })` / `additional(data)` merge top-level extras into the payload.
- Conditional pieces: `when(cond, valueOrFn)` (omitted entirely otherwise), `whenHas('title', (t) => ...)`, `whenLoaded('comments')` and its callback form for transforming loaded relations, `whenAggregated('comments', 'votes', 'sum')` for `withSum`-style columns. Values returned as `undefined` (the `MISSING_VALUE` sentinel) drop their key.
- Paginated collections embed the paginator's meta: `{ data: [...], meta: { total, per_page, last_page, next_page_url, prev_page_url } }` for `paginate()`, `{ data, links: { first, last, prev, next }, path, per_page }` for `cursorPaginate()`; simple paginators contribute no meta.
- A resource returns itself as JSON from any handler: route dispatch hands `JsonResponse` objects straight to the transport and `JSON.stringify`s everything else via the resource's `toJSON()` hook. Call `.response()` when you want the explicit `JsonResponse`, or build one yourself with `new JsonResponse(payload, 201, { 'X-Api': 'v1' })` for full status/header control.
- `X.collection(...)` wraps a list, an `EnsembleCollection` or a paginator and maps every item through `X` itself; standalone `ResourceCollection` subclasses instead point at their item mapper with `protected static collects = PostResource`. Single records: `new PostResource(post)` or `PostResource.make(post)`.

```typescript
class PostCollection extends ResourceCollection {
  protected static collects = PostResource;
}

return new PostCollection(posts).response(); // explicit JsonResponse
```

## Exception Handling

One `Handler` (bound in the container as `'exceptions'`) reports and renders
every error raised by the HTTP Kernel and the Router:

```typescript
import { abort, abort_if, abort_unless, AuthenticationException } from '@orchestr-sh/orchestr';

Route.get('/posts/:id', async (req) => {
  abort_if(!(await req.user()), 401); // throws AuthenticationException
  abort_unless(await req.can('view'), 403); // throws AccessDeniedHttpException
  abort(404, 'Post not found'); // throws NotFoundHttpException
});
```

Rendering is negotiated: JSON `{ message, errors? }` when the request expects
JSON or is served under the `api` prefix, and an HTML error page when the
client accepts `text/html` (stack traces appear only when `app.isDebug()`, which reads `APP_DEBUG`).
Status codes come from the exception hierarchy in `Foundation/Exceptions` -
`HttpException` (with custom headers), `NotFoundHttpException`,
`AccessDeniedHttpException` (403), `AuthenticationException` (401),
`ModelNotFoundException` (404) and `ValidationException` (422 with the error
bag). Add custom formats without touching the handler:

```typescript
kernel.getExceptionHandler().addRenderer(new MyXmlRenderer());
kernel.getExceptionHandler().dontReport(AuthenticationException); // variadic - pass classes, not an array
```

## Session & CSRF Protection

`SessionManager` builds session stores from config behind a `Store` contract,
with `array`, `file` and `cookie` drivers built in - and `extend()` registers
new drivers without touching the manager (OCP). The file store writes atomic,
expiring `sess_<id>` payloads; the cookie store carries the whole session in
one HMAC-signed payload:

```typescript
import {
  ConfigServiceProvider,
  SessionServiceProvider,
  StartSession,
  VerifyCsrfToken,
  Session,
  session,
} from '@orchestr-sh/orchestr';

app.register(new ConfigServiceProvider(app, {
  app: { key: 'your-app-key' }, // signs cookie-store payloads
  session: {
    driver: 'file', // array | file | cookie
    lifetime: 120, // minutes
    cookie: 'orchestr_session',
    path: '/',
    files: 'storage/framework/sessions',
    // HttpOnly + SameSite=Lax are defaults; Secure turns on in production
  },
}));

app.register(SessionServiceProvider);
kernel.use([StartSession, VerifyCsrfToken]); // use() takes one middleware or an array

Route.post('/login', (req) => {
  req.session().regenerate(); // new ID + token on login, data preserved
  Session.put('user_id', 1); // Session facade / session() / req.session()
  Session.flash('status', 'Welcome back'); // available for exactly one request
});
```

CSRF middleware rejects unsafe methods without the session token - accepted via
the `_token` input, the `X-CSRF-TOKEN` header, or the `X-XSRF-TOKEN` header
mirroring the readable `XSRF-TOKEN` cookie it sets for SPAs - with a 419 (Page
Expired). Exclude URIs through `config.csrf.except` (wildcards allowed) or
`makeVerifyCsrfToken({ except: [...] })`, and read the token in forms with
`csrf_token()` / `csrf_field()`:

```typescript
import { csrf_field } from '@orchestr-sh/orchestr';

Route.get('/charge', () => `<form method="POST" action="/charge">${csrf_field()}</form>`);
```

## Hashing & Encryption

`HashManager` puts password hashers behind the `Hasher` contract with three
drivers: `scrypt` (the default, pure `node:crypto` - no native addon
required), `bcrypt` and `argon2` (each an optional peer dependency that is
only loaded when used; installing orchestr without them yields an error that
names the package to add). Hash strings embed their algorithm and cost
parameters, so `check()` verifies old hashes correctly and `needsRehash()`
spots cost or algorithm changes:

```typescript
import { ConfigServiceProvider, HashServiceProvider, Hash, hash } from '@orchestr-sh/orchestr';

app.register(new ConfigServiceProvider(app, {
  hashing: { driver: 'scrypt', scrypt: { cost: 16384 } }, // or bcrypt/argon2
}));
app.register(HashServiceProvider);

const hashed = Hash.make('secret'); // hash('secret') works too
Hash.check('secret', hashed); // true - constant-time
Hash.check('wrong', hashed); // false
if (Hash.needsRehash(hashed)) { /* cost changed - rehash on login */ }
Hash.verifyConfiguration(); // throws when the configured options cannot round-trip
```

The `Encrypter` is AES-256-GCM with base64 JSON payloads carrying `iv`,
`value` and `tag`; tampered payloads or foreign keys fail with a
`DecryptException`, and an invalid `APP_KEY` (base64: prefixed, plain base64
or raw 32-byte) fails fast at boot:

```typescript
import { ConfigServiceProvider, EncryptionServiceProvider, Crypt, encrypt, decrypt } from '@orchestr-sh/orchestr';

app.register(new ConfigServiceProvider(app, {
  app: { key: 'base64:' + crypto.randomBytes(32).toString('base64') },
}));
app.register(EncryptionServiceProvider);

Crypt.decrypt(Crypt.encrypt({ a: 1 })); // { a: 1 }  (encrypt()/decrypt() too)
Crypt.decryptString(Crypt.encryptString('secret')); // 'secret'

class Credential extends Ensemble {
  static fillable = ['secret'];
  static casts = { secret: 'encrypted' }; // stores ciphertext, reads plaintext
}
```

## Signed URLs

`UrlGenerator` (reached through the router, the `Route` facade or
`kernel.middlewareAlias('signed', ValidateSignature)`) signs URLs with an
HMAC-SHA256 of the app key, covering path and query. An optional
`expires` (unix seconds or a `Date`) limits the link's lifetime, and the
middleware answers invalid, modified or expired signatures with a 403:

```typescript
import { ValidateSignature } from '@orchestr-sh/orchestr';

kernel.middlewareAlias('signed', ValidateSignature);

const route = Route.get('/unsubscribe/:id', unsubscribe).middleware('signed');
Route.name('unsubscribe', route);

const url = Route.signedRoute('unsubscribe', { id: 1 }); // ?signature=...
const temp = Route.temporarySignedRoute('unsubscribe', Math.floor(Date.now() / 1000) + 1800, { id: 1 });

Route.hasValidSignature(request); // false for a modified path or expired link
```

## Authentication

`AuthManager` builds guards from the Laravel-shaped `auth.*` config (`defaults.guard`,
`guards`, `providers`, `passwords`). Two guard drivers ship built-in - `session` and
`token` - and `Auth.extend()` registers custom drivers without touching the manager
(OCP). Guards own authentication; `EnsembleUserProvider` owns user retrieval (SRP),
configurable per provider with the model class, credential columns, password column
and rehash-on-login behaviour:

```typescript
import {
  ConfigServiceProvider,
  AuthServiceProvider,
  Authenticate, // 'auth' alias - installed on boot
  RedirectIfAuthenticated, // 'guest' alias - installed on boot
  Ensemble,
  HasAuthenticatable,
  Auth, // facade - auth() helper resolves a guard
  RedirectResponse,
  StartSession,
} from '@orchestr-sh/orchestr';

class User extends HasAuthenticatable(Ensemble) {
  static fillable = ['name', 'email', 'password'];
  getTable() {
    return 'users';
  }
}

app.register(new ConfigServiceProvider(app, {
  auth: {
    defaults: { guard: 'session' },
    guards: {
      session: { driver: 'session', provider: 'users' },
      token: { driver: 'token', provider: 'users', hash: false }, // Authorization: Bearer, ?api_token
    },
    providers: { users: { driver: 'ensemble', model: User, credentials: ['email'] } },
    passwords: { users: { provider: 'users', table: 'password_reset_tokens', expire: 60 } },
  },
}));

app.register(SessionServiceProvider);
app.register(HashServiceProvider);
app.register(AuthServiceProvider);
kernel.use(StartSession);
await app.boot(); // installs the 'auth' / 'guest' middleware aliases

Route.post('/login', async (req, res) => {
  await Auth.forRequest(req, res).attempt(req.only(['email', 'password']), req.input('remember') === '1');
  // session ID regenerated on login; remember=true stores a token on the
  // user and queues the `remember_{guard}_recaller` cookie
  return new RedirectResponse('/dashboard');
});

Route.get('/me', (req) => req.user()).middleware('auth'); // 401 JSON / login redirect for guests
Route.get('/login', loginForm).middleware('guest'); // authenticated visitors go home
await Auth.logout(); // clears the session and the stored remember token
```

## Authorization

`AuthServiceProvider` also registers the shared `Gate` service (`'gate'` in the
container, reachable through the `Gate` facade): one place where ability
callbacks, model policies, and `before`/`after` overrides resolve. The `'can'`
middleware, `Request.can/cannot/authorize`, `FormRequest.authorize()` and
`Rule.can()` all call the same gate, and denials throw the
`AuthorizationException` the exception handler renders as a 403 - carrying the
denial's message and status when the gate provided one:

```typescript
import { AuthServiceProvider, GateFacade as Gate, Policy, Rule, FormRequest } from '@orchestr-sh/orchestr';
// (plain `Gate` from the main entry is the underlying service class; its methods are
// instance methods. The facade - statics like these - is `GateFacade`, or `Gate`
// from '@orchestr-sh/orchestr/Facades'.)

class PostPolicy extends Policy {
  viewAny(user: Authenticatable): boolean {
    return true;
  }

  update(user: Authenticatable, post: Post): boolean | Response {
    return post.authorId === user.getAuthIdentifier() ? true : this.deny('Only authors may edit posts.');
  }
}

app.register(AuthServiceProvider); // binds 'gate' and installs the 'auth'/'guest'/'can' aliases

Gate.policy(Post, PostPolicy); // explicit registration (OCP: policies are registered, never hard-coded)
Gate.define('update-post', (user, post) => user?.getAuthIdentifier() === post.authorId);
Gate.before((user) => ((user as User)?.isSuperAdmin ? true : null)); // overrides every check for admins

await Gate.allows('update', post); // true | false
await Gate.denies('update', post);
await Gate.authorize('update', post); // Response - throws AuthorizationException on denial
await Gate.inspect('update', post); // Response with allowed/message/status, no throw
await Gate.forUser(null).allows('view', post); // check a specific user (or a guest)

// Policies are also discovered by convention: Gate.usePolicyNamespace('App\\Policies')
// resolves container-bound `App\\Policies\\PostPolicy` (and `PostPolicy`) classes,
// `Gate.guessPolicyNamesUsing(fn)` replaces the guesser, and a model's static
// `policy` property points at its policy without any registration.

Route.put('/posts/:post', update).middleware(['auth', 'can:update,post']); // 403 'Only authors...' on denial

class UpdatePostRequest extends FormRequest {
  protected async authorize() {
    return this.can('update', this.routeParam('post')); // the same gate, no duplicated checks
  }

  protected rules(): ValidationRules {
    return { title: ['required', Rule.can('update', this.routeParam('post'))] }; // gate-backed field rule
  }
}
```

## Filesystem & File Uploads

`FilesystemManager` builds disks from the `filesystems` config section behind a
small `Disk` contract (`put`, `get`, `exists`, `delete`, `copy`, `move`, `size`,
`lastModified`, `files`/`allFiles`, `directories`/`allDirectories`,
`makeDirectory`, `deleteDirectory`, `url`, `path`, `temporaryUrl`) over a
lower-level driver contract, so an S3 disk can be registered later with
`manager.extend('s3', ...)` without touching callers (OCP). Built in: the
`local`, `public` and `null` disks with configurable roots and URLs; the local
adapter jails every path below its root (`..` escapes throw
`PathTraversalException`) and writes atomically via temp-file + rename:

```typescript
import { ConfigServiceProvider, FilesystemServiceProvider, Storage, storage_path } from '@orchestr-sh/orchestr';

app.register(new ConfigServiceProvider(app, {
  filesystems: {
    default: 'local', // storage/app, no URLs
    disks: {
      local: { driver: 'local', root: storage_path('app') },
      public: { driver: 'local', root: storage_path('app/public'), url: '/storage' },
      null: { driver: 'null' }, // accepts writes, stores nothing
    },
  },
}));
app.register(FilesystemServiceProvider);

await Storage.put('notes.txt', 'Hello World'); // default disk
(await Storage.get('notes.txt'))?.toString(); // Buffer reads
await Storage.disk('local').delete('notes.txt');

Storage.disk('public').url('avatars/photo.png'); // '/storage/avatars/photo.png'
```

Multipart requests (any method with a body, DELETE included) are parsed by
`Request::parseBody()` with per-file and per-body memory ceilings: file parts
arrive as `UploadedFile` instances through `request.file('avatar')`,
`request.hasFile()` and `request.allFiles()`, oversized parts are rejected as
invalid uploads instead of exhausting memory, and storing delegates entirely
to the Disk contract - `store('avatars')` writes hash-named files to the
configured disk and returns the stored path, `storeAs`/`storePublicly`/
`storePubliclyAs` cover explicit names and the public disk:

```typescript
import { UploadedFile } from '@orchestr-sh/orchestr';

Route.post('/profile', async (request) => {
  const avatar = request.file('avatar') as UploadedFile; // multipart body parsed by parseBody()

  const path = await avatar.store('avatars'); // storage/app/avatars/<hash>.png
  const publicPath = await avatar.storePublicly('avatars'); // served at /storage/avatars/<hash>.png

  return { path, publicPath };
});
```

Upload validation is wired into the existing rules: `file`, `image`, `mimes`,
`mimetypes`, `dimensions` and the kilobyte `min`/`max`/`size` checks read the
upload's bytes (magic-byte MIME sniffing and image headers), so a text file
renamed `.png` fails `image` and a 4 MB upload fails `max:1024`.

## Collections, Strings & Helpers

### Collections

`Collection` is a real `Array` subclass: list items live in normal array slots (indexing, `for...of`, spread), while keyed entries (`put`, `groupBy`, `keyBy` results) are string-keyed properties. Transforms return **new** collections; only `transform`, `put`, `push`, `prepend`, `pop`, `shift`, `pull` and `forget` mutate in place. Comparisons (`where`, `contains`, `search`, `diff`, ...) use Laravel's loose `==` semantics.

```typescript
import { collect } from '@orchestr-sh/orchestr';

const users = collect([
  { id: 1, name: 'Anna', age: 30, role: 'admin' },
  { id: 2, name: 'Ben', age: 25, role: 'user' },
]);

users.where('role', 'admin').pluck('name').all(); // ['Anna']
users.groupBy('role').get('user')?.pluck('name').all(); // ['Ben']
collect([1, 2, 3]).flatMap((x) => [x, x * 10]).all(); // [1, 10, 2, 20, 3, 30]
collect([0, 1, false, 2, '', 3]).filter().all(); // [1, 2, 3]
collect().first(undefined, 'fallback'); // 'fallback'
```

The method surface mirrors Laravel's: `all keys values get has first last pluck map mapWithKeys flatMap filter reject reduce reduceWithKeys each sum avg median mode min max count isEmpty isNotEmpty contains doesntContain where whereIn whereNotIn firstWhere sortBy sortByDesc sort reverse slice take skip chunk collapse flatten unique merge concat combine diff intersect search groupBy keyBy put push prepend pop shift pull forget transform when unless tap pipe random shuffle implode join toArray toJson toJSON`, plus the statics `Collection.make/wrap/unwrap/range/times`. There is no async/lazy side to it - everything is synchronous.

One important note for ORM users: `Model.query().get()` resolves to a **plain array** of models. Wrap it with `collect(...)` when you want the fluent API. Loaded relations, by contrast, hydrate as `EnsembleCollection<T>` - a `Collection` subclass that adds `modelKeys()`, `find(key)`, `only/except(keys)`, `chunkModels(size)`, `toArray()` via `toObject()`, and the aggregate eager loaders `loadCount/loadSum/loadAvg/loadMin/loadMax/loadExists` (one query per relation for the whole set).

### Str, Arr, Number

All static utility classes, importable from the main entry:

```typescript
import { Str, Arr, Number as Num } from '@orchestr-sh/orchestr';

Str.studly('user name'); // 'UserName'
Str.slug('Hello World!', '-'); // 'hello-world'
Str.plural('child'); // 'children' - and Str.singular('feet')
Str.is('Model*', 'ModelSaved'); // wildcard checks
Str.random(16); Str.uuid(); Str.ulid();

Arr.get(config, 'database.connections.mysql.host'); // dot notation on arrays and objects
Arr.forget(record, 'a.b'); Arr.set(target, 'a.b', 1);
Arr.only(users, ['id', 'name']); // also: wrap/flatten/divide/keyBy/pluck/first/last/sort/shuffle/random/where/whereIn/toCssClasses
Arr.isList([1, 2]); Arr.isAssoc({ a: 1 });

Num.ordinal(3); // '3rd'
Num.fileSize(2_500_000, 1); // '2.4 MB' - binary units; Num.abbreviate, Num.percentage, Num.spell, Num.clamp, Num.format
```

`Number` intentionally shadows the JS global - alias it on import (`Number as Num`) if that clashes with your code.

### Global helpers

Everything is import-based; nothing touches `globalThis`:

| Helper | Behavior |
| --- | --- |
| `config(key?, default?)` | Reads the container's `Config`; no key returns the config instance itself. Throws if no application has been created yet. |
| `env(key, default?)` | Type-coerced `process.env` reads (see Configuration & Environment). |
| `base_path() / storage_path() / resource_path() / routes_path()` | Application-path helpers. |
| `view(name, data)` / `route(name, params)` | View instances, named-route URLs. |
| `session()` / `csrf_token()` / `csrf_field()` | Active request session + CSRF helpers (require StartSession). |
| `hash(value)` / `encrypt()` / `decrypt()` / `auth(guard?)` / `factory(Model, count?)` / `fake(...)` | Pass-throughs to the hashing, encryption, auth and factory subsystems; each throws a helpful error if its service provider isn't registered. |
| `data_get() / data_set() / value() / tap() / throw_if() / throw_unless() / class_basename()` | Laravel's utility helpers, dot-notation aware. |
| `optional(value)` | Null-safe proxy: `optional(user).get('profile.bio')`, plus chained property access, `.value`, `.call()`, `.collect()`. |
| `now()` / `today()` | Plain `Date`s (`today()` at local midnight) - there is no Carbon-style chain. |
| `str()` / `arr()` | Return the `Str` / `Arr` classes themselves, e.g. `str().slug('Hello')` - not fluent Stringable objects. |
| `snake_case() camel_case() studly_case() kebab_case() title_case()` | Legacy wrappers over their `Str` equivalents. |

### Facades & import names

Facades are container proxies: `Route`, `DB`, `Event`, `Queue`, `Bus`, `Cache`, `Schedule`, `Session`, `Storage`, `Auth`, `Gate`, `Hash`, `Crypt` and `View`. They resolve against the application registered via `Facade.setFacadeApplication(app)` - which the framework does inside `RouteServiceProvider.register()` (it also binds the `'router'` that `Route` and URL generation need). So registering `RouteServiceProvider` lights up every facade, and apps that skip it can call `Facade.setFacadeApplication(app)` by hand.

Because the main entry reserves bare names for core classes (`Event` = abstract event base, `Gate` = the gate service class, `View` = the view instance class, `Config` = the config repository facade object, `Schedule` = the scheduler class), several facades are exported **aliased** there, or bare from the `/Facades` subpath:

| Facade | From `'@orchestr-sh/orchestr'` | From `'@orchestr-sh/orchestr/Facades'` |
| --- | --- | --- |
| Event dispatcher | `EventFacade` | `Event` |
| Queue manager | `QueueFacade` | `Queue` |
| Gate | `GateFacade` | `Gate` |
| View factory | `ViewFacade` | *not exported* - use `ViewFacade` |
| Schedule | `ScheduleFacade` | `Schedule` |
| Bus / Cache / Session / Storage / Auth / Hash / Crypt / Route / DB | same name | same name |

The `/Facades` entry also exports `EventFake` for typed test fakes. One name to watch: bare `Config` is a facade alias over the container's config repository, while the repository class itself is `ConfigClass` - prefer the `config()` helper for reads (see [Configuration & Environment](#configuration--environment)).

## Configuration & Environment

### Environment files

`new Application(...)` loads environment files right in its constructor - before `boot()`, before any provider runs:

1. `{basePath}/.env` (rename the file with `app.setEnvironmentFile('custom.env')`)
2. `{basePath}/.env.{APP_ENV}` (e.g. `.env.production`, `.env.local`), if it differs

Values already present in the real `process.env` always win over file values (the host environment is authoritative unless you call `Env.load(path, /* overwrite */ true)`), and a missing `.env` is not an error. The file parser understands `export` prefixes, single-quoted literal values, double-quoted values with escapes and multiline strings, inline comments, and `${VAR}` / `${VAR:-fallback}` interpolation.

```bash
# .env
APP_ENV=production
APP_DEBUG=false
APP_KEY=base64:...
DB_HOST=127.0.0.1
```

```typescript
import { env, Env } from '@orchestr-sh/orchestr';

env('DB_HOST'); // '127.0.0.1' - string
env('APP_DEBUG'); // false - 'true'/'false'/'null'/'empty' coerce (case-insensitive); wrap in (true) to keep the literal string
env('NO_SUCH_KEY', 'fallback'); // null returns the default
```

`Env.load(path, overwrite?)`, `Env.get/set/has/forget/parse` are the statics underneath; everything else just reads the resulting `process.env`. Numeric values stay strings - coerce at the call site or with `config` defaults.

The application answers environment questions from these values:

```typescript
app.environment(); // APP_ENV || NODE_ENV || 'production'
app.environment('local', 'feature-*'); // is the current env one of these (wildcards ok)
app.isLocal(); app.isProduction(); app.isTesting();
app.isDebug(); // APP_DEBUG === true
app.version(); // the installed @orchestr-sh/orchestr version
```

### Config files

Keep configuration in a top-level `config/` directory: `config/database.ts`, `config/cache.js` or `config/app.json` each `default`-export an object (or, for JSON, *is* the object) and land under the `database.` / `cache.` / `app.` keys. `app.boot()` loads and deep-merges them over anything registered inline:

```typescript
// config/database.ts
export default {
  default: 'sqlite',
  connections: {
    sqlite: { adapter: 'drizzle', driver: 'sqlite', database: './database.db' },
  },
};
```

```typescript
import { ConfigServiceProvider, config } from '@orchestr-sh/orchestr';

// Inline values work too - and merge with the files (files win):
app.register(new ConfigServiceProvider(app, { app: { name: 'My App' } }));

config('database.connections.sqlite.database'); // './database.db'
config('app.timezone', 'UTC'); // default when unset
```

`boot()` auto-registers a `ConfigServiceProvider` if you never registered one, so file-based config is always live. The repository itself (`ConfigClass`) offers the full dot API: `get/set/has/all/getMany/forget/prepend/push/merge`.

### Caching configuration

```bash
npx orchestr config:cache # compiles config/* into bootstrap/cache/config.json
npx orchestr config:clear # removes the snapshot; files are read again
```

While the snapshot exists the app loads only that (`app.configurationIsCached()`), so edited config files take effect after `config:clear` - there is no staleness detection. The path is overridable with `APP_CONFIG_CACHE`. Because the snapshot is JSON, configs holding closures (e.g. callbacks wired into service classes) cannot be cached; `config:cache` refuses them and lists the offending dot-paths.

### Database setup

The built-in `DatabaseServiceProvider` binds the `'db'` manager from `config('database')`, but does not connect or hand the resolver to Ensembles - a small provider of your own does:

```typescript
import { ServiceProvider, DatabaseManager, Ensemble } from '@orchestr-sh/orchestr';

export class BootDatabaseServiceProvider extends ServiceProvider {
  async boot(): Promise<void> {
    const db = this.app.make<DatabaseManager>('db');
    await db.connection().connect();
    Ensemble.setConnectionResolver(db); // enables Model.query() & friends
  }
}

app.register(DatabaseServiceProvider); // 'db' binding + the drizzle adapter
app.register(BootDatabaseServiceProvider); // connect & wire Ensembles
```

### Service Providers

```typescript
import { ServiceProvider } from '@orchestr-sh/orchestr';

export class AppServiceProvider extends ServiceProvider {
  register(): void {
    this.app.singleton('myService', () => new MyService());
  }

  async boot(): Promise<void> {
    // Bootstrap code
  }
}
```

## API Reference

### Ensemble Methods

```typescript
// Query
User.query()              // Get query builder
User.find(id)             // Find by primary key
User.findOrFail(id)       // Find or throw error
User.all()                // Get all records
User.create(data)         // Create and save

// Instance methods
user.setAttribute(k, v)   // Mutate a tracked attribute (fill({...}) for many)
user.save()               // Save changes
user.delete()             // Delete record
user.refresh()            // Reload from database
user.load('posts')        // Lazy load relationship
user.loadCount('posts')   // Lazy load an aggregate of a relationship
user.loadSum('comments', 'votes') // ...sums, averages, minimums, maximums, existence
user.toObject()           // Convert to plain object
```

### Query Builder Methods

```typescript
.where(column, value)
.where(column, operator, value)
.orWhere(column, value)
.whereIn(column, array)
.whereBetween(column, [min, max])
.whereNull(column)
.whereColumn(first, operator, second)  // Compare two columns
.orWhereColumn(first, operator, second)
.whereExists(subQuery)                 // Correlated sub-select
.whereNotExists(subQuery)
.orWhereExists(subQuery)
.orderBy(column, direction)
.limit(number)
.offset(number)
.join(table, first, operator, second)
.groupBy(column)
.having(column, operator, value)
.select(columns)
.count()
.sum(column)
.avg(column)
.min(column)
.max(column)
.has('comments')                       // Relationship existence filters
.whereHas('comments', (query) => query.where('approved', true))
.whereRelation('comments', 'approved', true)
.whereBelongsTo(user)
.withCount('comments')                 // Relationship aggregates
.withSum('comments', 'votes')
.withExists('comments')
.toSql()                  // Compiled statement, with bindings separate
.toRawSql()               // Same statement with bindings interpolated in, for debugging only
```

### Schema Methods

```typescript
schema.create(table, callback)      // Create new table
schema.table(table, callback)       // Modify existing table
schema.drop(table)                  // Drop table
schema.dropIfExists(table)          // Drop table if exists
schema.rename(from, to)             // Rename table
schema.hasTable(table)              // Check if table exists
schema.hasColumn(table, column)     // Check if column exists
schema.disableForeignKeyConstraints() // Switch constraint checking off
schema.enableForeignKeyConstraints()  // ...and back on
schema.withoutForeignKeyConstraints(callback) // Run a callback with them off
```

### Blueprint Column Types

```typescript
table.id()                          // Auto-increment big integer
table.increments(column)            // Auto-increment integer
table.bigIncrements(column)         // Auto-increment big integer
table.string(column, length)        // VARCHAR
table.text(column)                  // TEXT
table.mediumText(column)            // MEDIUMTEXT
table.longText(column)              // LONGTEXT
table.integer(column)               // INTEGER
table.bigInteger(column)            // BIGINT
table.smallInteger(column)          // SMALLINT
table.tinyInteger(column)           // TINYINT
table.decimal(column, precision, scale)
table.float(column, precision, scale)
table.double(column, precision, scale)
table.boolean(column)               // BOOLEAN
table.date(column)                  // DATE
table.datetime(column, precision)   // DATETIME
table.timestamp(column, precision)  // TIMESTAMP
table.timestamps(precision)         // created_at & updated_at
table.json(column)                  // JSON
table.jsonb(column)                 // JSONB
table.uuid(column)                  // UUID
table.enum(column, values)          // ENUM
table.binary(column)                // BINARY
table.rememberToken()               // remember_token VARCHAR(100)
table.softDeletes(column)           // deleted_at timestamp
table.ulid(column)                  // 26 character identifier
table.foreignId(column)             // unsigned big integer, for constrained()
table.foreignIdFor(model, column)   // foreign key column derived from a model
table.morphs(name)                  // <name>_type + <name>_id
table.nullableMorphs(name)          // the pair, nullable
```

### Blueprint Key and Change Methods

```typescript
table.index(columns, indexName)     // Add an index
table.unique(columns, indexName)    // Add a unique index
table.primary(columns)              // Add a composite primary key
table.foreign(columns, name)        // Add a foreign key constraint
table.dropColumn(column)            // Drop column(s)
table.dropTimestamps(column)        // Drop created_at / updated_at
table.dropSoftDeletes(column)       // Drop deleted_at
table.dropIndex(columns)            // Drop an index by name or columns
table.dropUnique(columns)           // Drop a unique index
table.dropForeign(columns)          // Drop a foreign key
table.dropPrimary()                 // Drop the primary key
table.renameIndex(from, to)         // Rename an index
table.renameColumn(from, to)        // Rename a column
table.change(column)                // Redefine existing column(s)
```

### Relationship Methods

```typescript
// HasOne, HasMany, BelongsTo
.get()                    // Execute query
.first()                  // Get first result
.create(data)             // Create related model
.where(column, value)     // Add constraint

// BelongsToMany
.attach(ids)              // Attach related models
.detach(ids)              // Detach related models
.sync(ids)                // Sync relationships
.toggle(ids)              // Toggle relationships
.wherePivot(column, value) // Query pivot table
.updateExistingPivot(id, data) // Update pivot data

// All relationships
.with('relation')         // Eager load
.with(['relation1', 'relation2'])
.with({ relation: (q) => q.where(...) })

// On the model query, for any relationship
.has('relation')          // Keep rows the relation has rows for
.doesntHave('relation')   // ...and the inverse
.whereHas('relation', (q) => q.where(...)) // ...constrained by the related query
.whereRelation('relation', 'column', value) // ...by a single column
.whereBelongsTo(model)    // ...by the related model of an inverse relation
.withCount('relation')    // Eager load an aggregate of the relation
.loadCount('relation')    // ...onto models you already have
```

### Available Relationships

- `HasOne` - One-to-one
- `HasMany` - One-to-many
- `BelongsTo` - Inverse of HasOne/HasMany
- `BelongsToMany` - Many-to-many
- `MorphOne` - Polymorphic one-to-one
- `MorphMany` - Polymorphic one-to-many
- `MorphTo` - Inverse of MorphOne/MorphMany
- `MorphToMany` - Polymorphic many-to-many
- `MorphedByMany` - Inverse of MorphToMany

### CLI Commands

All commands run via `npx orchestr` (or `orchestr` when installed globally). The kernel parses `command arg1 arg2 --key=value --flag` generically, so options below are `--key=value` pairs or bare `--flags`, and `[bracketed]` items are positional arguments.

| Command | Does |
| --- | --- |
| `migrate` | Run pending migrations (`--step`, `--seed`, `--force`, `--pretend`, `--path=`) |
| `migrate:install` | Create the migrations repository table |
| `migrate:rollback` | Roll back the last batch |
| `migrate:reset` | Roll back all migrations |
| `migrate:refresh` | Reset and re-run all migrations |
| `migrate:fresh` | Drop all tables and re-migrate |
| `migrate:status` | Show each migration's status |
| `make:migration <name>` | New migration stub (`--create` + `--table=users` for a create stub, `--table` alone for an update stub) |
| `db:seed` | Run `DatabaseSeeder` (`--class=UserSeeder` for one seeder) |
| `make:seeder <name>` | New seeder class |
| `make:model <name>` | New Ensemble model in `app/Models` (`--migration`/`-m`, `--factory`/`-f`, `--seed`/`-s`, `--pivot`/`-p` + `--table=`, `--all`; matching companions generated too) |
| `make:request <name>` | New form request in `app/Http/Requests` |
| `make:middleware <name>` | New middleware in `app/Http/Middleware` |
| `make:provider <name>` | New service provider in `app/Providers` |
| `make:observer <name>` | New observer in `app/Observers` (`--model=Post` to type the hooks) |
| `make:policy <name>` | New policy in `app/Policies` (`--model=Post` for the model-bound verbs) |
| `make:factory <name>` | New factory in `database/factories` (`--model=` or the `PostFactory`-pairs-with-`Post` convention) |
| `make:resource <name>` | New JSON resource in `app/Http/Resources` (`--collection` for a ResourceCollection) |
| `make:collection <name>` | New ResourceCollection wired to its `<Name>Resource` |
| `make:rule <name>` | New invokable validation rule in `app/Rules` |
| `make:command <name>` | New console command in `app/Console/Commands` (`--command=` to name the signature) |
| `make:test <name>` | New test in `tests/Feature` (`--unit` for `tests/Unit`) |
| `make:mail <name>` | New mail class in `app/Mail` |
| `make:notification <name>` | New notification class in `app/Notifications` |
| `make:cast <name>` | New custom cast in `app/Casts` |
| `make:channel <name>` | New broadcast channel class in `app/Broadcasting` |
| `make:exception <name>` | New exception class in `app/Exceptions` |
| `make:enum <name>` | New enum in `app/Enums` |
| `make:interface <name>` | New interface in `app/Contracts` |
| `make:trait <name>` | New trait-as-mixin in `app/Traits` |
| `make:class <name>` | New plain class (at the `app/` root, or in subdirectories named in the input) |
| `make:event <name>` | New event class |
| `make:listener <name>` | New listener (`--event=EventName`, `--queued`) |
| `make:controller <name>` | New controller in `app/Http/Controllers` (`--path=` to override) |
| `event:list` | List registered events (`--event=` to filter) |
| `event:cache` | Discover and cache events & listeners |
| `event:clear` | Clear the cached events |
| `make:job <name>` | New job class (`--sync` for a synchronous job) |
| `queue:work [connection]` | Worker daemon (`--queue=high,default`, `--tries=3`, `--timeout=90`, `--sleep=3`, `--once`, `--stop-when-empty`, `--max-jobs=`, `--max-time=`, `--memory=`, `--rest=`) |
| `queue:listen [connection]` | Supervisor that respawns `queue:work` (`--watch=src,app` restarts on file changes) |
| `queue:restart` | Gracefully restart all workers |
| `queue:failed` | List failed jobs |
| `queue:retry <id>` | Retry one (`all` for every failed job) |
| `queue:forget <id>` | Delete one failed job |
| `queue:flush` | Delete all failed jobs |
| `queue:clear [connection]` | Delete every job on a queue (`--queue=default`) |
| `queue:monitor [queues]` | Alert when queue size exceeds `--max` (default 1000) |
| `queue:table` | Create the jobs table migration |
| `queue:failed-table` | Create the failed_jobs table migration |
| `queue:batches-table` | Create the job_batches table migration |
| `queue:prune-batches` | Prune stale batches (`--hours=24`) |
| `queue:prune-failed` | Prune old failed jobs (`--hours=48`) |
| `cache:clear [store]` | Flush the cache (default store, or e.g. `cache:clear redis`) |
| `cache:forget <key> [store]` | Forget one key |
| `cache:table` | Create the cache table migration |
| `config:cache` | Compile `config/*` into `bootstrap/cache/config.json` |
| `config:clear` | Remove the configuration snapshot |
| `schedule:run` | Run all due tasks (your single crontab line) |
| `schedule:work` | Long-running minute loop around `schedule:run` |
| `schedule:list` | Registered tasks and next run times (`--timezone=`) |
| `schedule:test [task]` | Run one task immediately |
| `make:view <name>` | New view template under `resources/views` |

The deploy commands (`deploy:login`, `deploy:init`, `deploy:server`, `deploy`, `deploy:status`, `deploy:env`, `deploy:rollback`, `deploy:provision`) are registered alongside these - see [Deploying](#deploying).

## Queue System

Orchestr provides a powerful queue system for deferring time-intensive tasks. Jobs can be pushed to various drivers (sync, database, redis, null), retried on failure, organized into chains and batches, and monitored through a comprehensive CLI.

### Configuration

Create a queue configuration in your application:

```typescript
import { QueueServiceProvider } from '@orchestr-sh/orchestr';

app.register(new QueueServiceProvider(app));

// Configure in ConfigServiceProvider
{
  queue: {
    default: 'database',
    connections: {
      sync: {
        driver: 'sync',
      },
      database: {
        driver: 'database',
        table: 'jobs',
        queue: 'default',
        retry_after: 90,
        after_commit: false,
      },
      redis: {
        driver: 'redis',
        queue: 'default',
        retry_after: 90,
        after_commit: false,
        prefix: 'orchestr', // key prefix for lists / sorted sets / payload hash
        // ioredis connection options (requires the optional `ioredis` peer dependency):
        host: '127.0.0.1',
        port: 6379,
        password: undefined,
        db: 0,
      },
    },
    failed: {
      driver: 'database',
      database: 'sqlite',
      table: 'failed_jobs',
    },
    batching: {
      database: 'sqlite',
      table: 'job_batches',
    },
  },
}
```

### Redis Driver

The `redis` driver stores available jobs in per-queue lists, delayed jobs in a
sorted set scored by their availability time, and in-flight jobs in a sorted
set scored by a `retry_after` deadline - so a crashed worker's job is
automatically recovered once its reservation expires. The pop (promoting due
delayed jobs, recovering expired reservations, and reserving the next job)
runs as a single atomic Lua script, guaranteeing two workers never receive the
same job.

`ioredis` is an optional peer dependency. Install it only when you use the
redis connection:

```bash
npm install ioredis
```

```typescript
import { RedisQueueDriver } from '@orchestr-sh/orchestr';

// Or register it explicitly with your own client (handy for tests):
const manager = app.make<QueueManager>('queue');
manager.registerDriver('redis', (config) => new RedisQueueDriver(config, myRedisClient));
```

### Testing: Faking the Queue

`Queue.fake()` swaps the queue for a recorder so dispatches are asserted
instead of executed:

```typescript
import { QueueFacade as Queue } from '@orchestr-sh/orchestr';

const queue = Queue.fake();

await ProcessPodcast.dispatch(podcastId);

queue.assertPushed(ProcessPodcast);
queue.assertPushedOn('high', ProcessPodcast);
queue.assertNotPushed(SendAnalyticsReport);
queue.assertPushedWithChain(StartJob, ['OptimizeJob', 'ReleaseJob']);
queue.assertPushedWithBatch(ImportRow, batch.id);
queue.assertNothingPushed(); // throws - jobs were recorded
```

### Unique Jobs

A job implementing `ShouldBeUnique` acquires a cache lock at dispatch; while
the lock is held, additional dispatches with the same `uniqueId()` are
silently skipped. The worker releases the lock when the job finishes or
permanently fails (or after `uniqueFor` seconds elapse). Implement
`ShouldBeUniqueUntilProcessing` to release the lock as soon as the job is
popped (before it runs):

```typescript
import { Job, ShouldBeUnique } from '@orchestr-sh/orchestr';

export class UpdateSearchIndex extends Job implements ShouldBeUnique {
  public uniqueFor = 3600; // lock safety-net TTL (seconds)

  constructor(public productId: number) {
    super();
  }

  uniqueId(): string {
    return `search-index-${this.productId}`;
  }

  async handle(): Promise<void> {
    // ...
  }
}
```

Uniqueness requires the cache subsystem (`CacheServiceProvider`) and a
container-backed `QueueManager`.

### Dispatching After Commit

A job dispatched with `afterCommit()` (or on a connection with
`after_commit: true`) is not pushed until the outermost database transaction
commits, and is discarded if that transaction rolls back - so a queued job
never observes uncommitted data:

```typescript
await ProcessPodcast.dispatch(podcastId).afterCommit();
```

The transaction is resolved from the driver's own connection (the `database`
driver) or, failing that, the application's default `db` connection.

### Creating Jobs

Jobs are classes that extend the `Job` base class:

```typescript
import { Job } from '@orchestr-sh/orchestr';

export class ProcessPodcast extends Job {
  public tries = 5;
  public timeout = 120;
  public backoff = [10, 30, 60];

  constructor(public podcastId: number) {
    super();
  }

  async handle(): Promise<void> {
    // Process the podcast
    const podcast = await Podcast.find(this.podcastId);
    await podcast.process();
  }

  async failed(error: Error): Promise<void> {
    // Handle job failure
    console.error(`Failed to process podcast ${this.podcastId}:`, error);
  }
}

// Create via CLI
npx orchestr make:job ProcessPodcast
npx orchestr make:job SendEmail --sync  // Synchronous job
```

### Dispatching Jobs

```typescript
// Basic dispatch
await ProcessPodcast.dispatch(podcastId);

// Fluent dispatch API
await ProcessPodcast.dispatch(podcastId)
  .onQueue('high-priority')
  .onConnection('redis')
  .delay(60)
  .tries(3)
  .timeout(300)
  .backoff([30, 60, 120]);

// Conditional dispatch
await ProcessPodcast.dispatchIf(podcast.needsProcessing, podcastId);
await ProcessPodcast.dispatchUnless(podcast.isProcessed, podcastId);

// Synchronous dispatch (runs immediately)
await ProcessPodcast.dispatchSync(podcastId);

// Using Queue/Bus facades
import { QueueFacade as Queue, Bus } from '@orchestr-sh/orchestr';

await Queue.push(new ProcessPodcast(podcastId));
await Queue.pushOn('high-priority', new ProcessPodcast(podcastId));
await Queue.later(60, new ProcessPodcast(podcastId));

await Bus.dispatch(new ProcessPodcast(podcastId));
await Bus.dispatchSync(new ProcessPodcast(podcastId));
```

### Job Middleware

Middleware can be applied to jobs for rate limiting, preventing overlaps, and throttling exceptions:

```typescript
import { RateLimited, WithoutOverlapping, ThrottlesExceptions } from '@orchestr-sh/orchestr';

export class ProcessPodcast extends Job {
  constructor(public podcastId: number) {
    super();
  }

  middleware() {
    return [
      // Allow 10 jobs per minute
      new RateLimited('podcasts', 10, 60).releaseAfter(30),

      // Prevent overlapping jobs for the same podcast
      new WithoutOverlapping(this.podcastId)
        .releaseAfter(10)
        .expireAfter(300),

      // Throttle on too many exceptions
      new ThrottlesExceptions(5, 10).backoff(5),
    ];
  }

  async handle(): Promise<void> {
    // Process podcast
  }
}
```

### Job Chaining

Execute jobs sequentially - if one fails, the chain stops:

```typescript
import { Bus } from '@orchestr-sh/orchestr';

await Bus.chain([
  new ProcessPodcast(podcastId),
  new OptimizePodcast(podcastId),
  new PublishPodcast(podcastId),
  new NotifySubscribers(podcastId),
])
  .onQueue('processing')
  .onConnection('redis')
  .delay(300)
  .catch((error) => {
    console.error('Chain failed:', error);
  })
  .dispatch();
```

### Job Batching

Execute jobs concurrently with progress tracking:

```typescript
import { Bus } from '@orchestr-sh/orchestr';

const batch = await Bus.batch([
  new ImportRow(1),
  new ImportRow(2),
  new ImportRow(3),
  new ImportRow(4),
])
  .name('CSV Import')
  .then((batch) => {
    console.log('All imports complete!');
  })
  .catch((batch, error) => {
    console.error('A job failed:', error);
  })
  .finally((batch) => {
    console.log(`Processed ${batch.processedJobs}/${batch.totalJobs} jobs`);
  })
  .allowFailures()
  .onQueue('imports')
  .dispatch();

// Check batch progress
console.log(`Progress: ${batch.progress()}%`);
console.log(`Pending: ${batch.pendingJobs}`);
console.log(`Failed: ${batch.failedJobs}`);
```

### Running Workers

Process queued jobs with the worker daemon:

```bash
# Start a worker
npx orchestr queue:work

# Specify connection and queue
npx orchestr queue:work database --queue=high-priority,default

# Worker options
npx orchestr queue:work database \
  --queue=high,default \
  --tries=3 \
  --timeout=90 \
  --sleep=3 \
  --max-jobs=1000 \
  --max-time=3600 \
  --memory=128 \
  --rest=0

# Process a single job (--once)
npx orchestr queue:work --once

# Stop when queue is empty
npx orchestr queue:work --stop-when-empty

# Restart all workers gracefully
npx orchestr queue:restart

# Development loop: keep the worker running, restarting it automatically
npx orchestr queue:listen
npx orchestr queue:listen redis --queue=high,default

# Restart the worker when source files change (default: ./src)
npx orchestr queue:listen --watch=src,app
```

`queue:work` is the production daemon: it boots once and caches loaded code.
`queue:listen` is the development counterpart - it supervises short-lived
`queue:work` child processes and respawns them whenever the worker exits, a
`queue:restart` (SIGUSR2) signal arrives, or (with `--watch`) source files
change, so code edits always take effect without a manual restart.

### Failed Jobs

Manage failed jobs through the CLI or programmatically:

```bash
# List all failed jobs
npx orchestr queue:failed

# Retry a specific failed job
npx orchestr queue:retry 5

# Retry all failed jobs
npx orchestr queue:retry all

# Forget (delete) a failed job
npx orchestr queue:forget 5

# Flush all failed jobs
npx orchestr queue:flush

# Prune failed jobs older than 48 hours
npx orchestr queue:prune-failed --hours=48
```

### Queue Monitoring

```bash
# Monitor queue for jobs exceeding thresholds
npx orchestr queue:monitor database:default --max=100

# Clear all jobs from a queue
npx orchestr queue:clear database --queue=default
```

### Database Setup

```bash
# Create queue tables migration
npx orchestr queue:table

# Create failed jobs table migration
npx orchestr queue:failed-table

# Create job batches table migration
npx orchestr queue:batches-table

# Run migrations
npx orchestr migrate
```

### Job Events

Register callbacks for job lifecycle events:

```typescript
import { QueueFacade as Queue } from '@orchestr-sh/orchestr';

// Before job processing
Queue.before((connectionName, job) => {
  console.log(`Processing: ${job.displayName()}`);
});

// After job processing
Queue.after((connectionName, job) => {
  console.log(`Completed: ${job.displayName()}`);
});

// When a job fails
Queue.failing((connectionName, job, error) => {
  console.error(`Failed: ${job.displayName()}`, error);
});

// On each worker loop iteration
Queue.looping(() => {
  // Perform maintenance tasks
});
```

### Custom Queue Drivers

Extend the queue system with custom drivers. Built-in drivers include `sync`,
`database`, `null`, and `redis`; a custom driver implements the same
`QueueDriver` contract (and optionally `executesInline()` /
`getTransactionConnection()` to integrate with unique jobs and `after_commit`
dispatching):

```typescript
import { QueueDriver, QueueDriverJob, Job } from '@orchestr-sh/orchestr';

class SqsDriver implements QueueDriver {
  async push(job: Job, queue?: string): Promise<string> {
    // Push job to SQS
    return jobId;
  }

  async pop(queue?: string): Promise<QueueDriverJob | null> {
    // Pop (and reserve) the next job from SQS
    return null;
  }

  // Implement size/later/bulk/release/delete/clear/getConnectionName/... as well

  getConnectionName(): string {
    return 'sqs';
  }
  setConnectionName(name: string): void {}
  getQueue(queue?: string): string {
    return queue || 'default';
  }
  async size(): Promise<number> {
    return 0;
  }
  async pushRaw(payload: string, queue?: string): Promise<string> {
    return '';
  }
  async later(delay: number | Date, job: Job, queue?: string): Promise<string> {
    return this.push(job, queue);
  }
  async bulk(jobs: Job[], queue?: string): Promise<void> {}
  async release(id: string, delay?: number): Promise<void> {}
  async delete(id: string): Promise<void> {}
  async clear(queue?: string): Promise<number> {
    return 0;
  }
}

// Register the driver
const manager = app.make<QueueManager>('queue');
manager.registerDriver('sqs', (config) => new SqsDriver(config));
```

### Job Timeouts & Cancellation

Every job runs under a timeout (`job.timeout`, falling back to the worker's
`--timeout`). On expiry the worker aborts the job's `AbortSignal` and marks
the job failed:

```typescript
export class GenerateReport extends Job {
  public timeout = 30;

  async handle(signal?: AbortSignal): Promise<void> {
    // Cooperative: stop early when the worker asks for cancellation
    for (const chunk of this.chunks) {
      if (signal?.aborted || this.cancelled) return;
      await process(chunk);
    }
  }
}
```

The signal is passed to `handle()` and is also available as `job.signal` /
`job.cancelled`. JavaScript promises cannot be cancelled in-process, so a
non-cooperative `handle()` keeps running after the timeout; the worker still
marks the job failed and moves on. Deploy long-running or untrusted jobs on an
isolated runner (worker thread / child process) if their work must be killed
outright.


## Cache System

Orchestr provides a flexible caching system with multiple drivers, tags, locks, and stale-while-revalidate support.

### Configuration

Configure cache stores in your application:

```typescript
import { CacheServiceProvider } from '@orchestr-sh/orchestr';

app.register(new CacheServiceProvider(app));

// Configure in ConfigServiceProvider
{
  cache: {
    default: 'file',
    prefix: 'app_cache_',
    stores: {
      array: {
        driver: 'array',
        serialize: false,
      },
      file: {
        driver: 'file',
        path: 'storage/framework/cache/data',
      },
      database: {
        driver: 'database',
        connection: null,
        table: 'cache',
      },
      redis: {
        driver: 'redis',
        host: '127.0.0.1',
        port: 6379,
        password: undefined,
        db: 0,
      },
      null: {
        driver: 'null',
      },
    },
    remember: {
      lock: false, // stampede protection for remember()
      lock_seconds: 30,
    },
  },
}
```

### Basic Usage

```typescript
import { Cache } from '@orchestr-sh/orchestr';

// Store items
await Cache.put('key', 'value', 3600); // TTL in seconds
await Cache.put('key', 'value', new Date('2024-12-31')); // TTL as Date
await Cache.forever('key', 'value'); // Store forever

// Retrieve items
const value = await Cache.get('key');
const value = await Cache.get('key', 'default value');
const value = await Cache.get('key', () => 'computed default');

// Multiple items
await Cache.putMany({ key1: 'value1', key2: 'value2' }, 3600);
const values = await Cache.many(['key1', 'key2']);

// Check existence
if (await Cache.has('key')) {
  // Key exists
}

if (await Cache.missing('key')) {
  // Key does not exist
}

// Remove items
await Cache.forget('key');
await Cache.flush(); // Clear all cache

// Retrieve and delete
const value = await Cache.pull('key', 'default');
```

### Remember Pattern

Cache the result of expensive operations:

```typescript
// Cache for 1 hour if not exists
const user = await Cache.remember('user:1', 3600, async () => {
  return await User.find(1);
});

// Cache forever if not exists
const settings = await Cache.rememberForever('settings', async () => {
  return await fetchSettings();
});

// Add only if key doesn't exist
await Cache.add('key', 'value', 3600);
```

### Flexible Caching (Stale-While-Revalidate)

Serve stale content while revalidating in the background:

```typescript
// Fresh for 30s, stale for up to 300s
const data = await Cache.flexible('api:data', [30, 300], async () => {
  return await fetchFromAPI();
});

// First 30 seconds: serves fresh data
// After 30 seconds: serves stale data, triggers background refresh
// After 300 seconds: fetches fresh data synchronously
```

### Incrementing and Decrementing

```typescript
// Increment
await Cache.increment('views'); // +1
await Cache.increment('views', 5); // +5

// Decrement
await Cache.decrement('views'); // -1
await Cache.decrement('views', 3); // -3
```

### Multiple Stores

Switch between different cache stores:

```typescript
// Use specific store
await Cache.store('redis').put('key', 'value', 3600);
await Cache.store('file').put('key', 'value', 3600);
await Cache.store('database').put('key', 'value', 3600);

// Chain operations
const value = await Cache.store('redis').remember('expensive', 3600, async () => {
  return await computeExpensiveValue();
});
```

### Cache Tags

Group related cache entries for easy invalidation:

```typescript
// Store tagged items
await Cache.tags(['people', 'artists']).put('John', johnData, 3600);
await Cache.tags(['people', 'authors']).put('Anne', anneData, 3600);
await Cache.tags('products').put('product:1', productData, 3600);

// Retrieve tagged items
const john = await Cache.tags(['people', 'artists']).get('John');

// Flush by tag (removes all tagged entries)
await Cache.tags('people').flush(); // Removes John and Anne
await Cache.tags(['people', 'artists']).flush();

// Remember with tags
const user = await Cache.tags(['users', 'premium']).remember('user:1', 3600, async () => {
  return await User.find(1);
});
```

### Cache Locks

Atomic locks for preventing race conditions:

```typescript
// Basic lock usage
const lock = Cache.lock('processing', 120);

if (await lock.get()) {
  try {
    // Critical section
    await processExpensiveOperation();
  } finally {
    await lock.release();
  }
}

// Auto-release with callback
await Cache.lock('processing', 120).get(async () => {
  // Lock is automatically released after callback
  await processExpensiveOperation();
});

// Block until lock is acquired
try {
  await Cache.lock('processing', 120).block(10, async () => {
    // Wait up to 10 seconds for lock
    await processExpensiveOperation();
  });
} catch (error) {
  // LockTimeoutException after 10 seconds
}

// Check lock ownership
const lock = Cache.lock('processing', 120);
await lock.get();

if (await lock.isOwnedByCurrentProcess()) {
  await lock.release();
}

// Force release (ignores ownership)
await lock.forceRelease();
```

### Database Setup

```bash
# Create cache table migration
npx orchestr cache:table

# Run migration
npx orchestr migrate
```

### Cache Commands

```bash
# Clear all cache
npx orchestr cache:clear

# Clear specific store (the store name is a positional argument)
npx orchestr cache:clear redis

# Forget a specific key
npx orchestr cache:forget key-name

# Forget from specific store
npx orchestr cache:forget key-name redis
```

### Redis Store

The `redis` driver is built in and backed by the optional `ioredis` peer
dependency (install it only when a redis connection is used):

```bash
npm install ioredis
```

```typescript
// config: cache.stores.redis = { driver: 'redis', host, port, password, db }
await Cache.store('redis').put('key', 'value', 3600);

// Cache.lock() runs as atomic Redis Lua scripts on this store, so two
// processes can never hold the same lock and only the owner can release it.
await Cache.store('redis').lock('processing', 120).get(async () => {
  await processExpensiveOperation();
});

// Extend a key's TTL without touching its value, or change the prefix live.
await Cache.touch('key', 3600);
Cache.setPrefix('app_');
```

### Stampede-Protected Remember

`remember()`/`rememberForever()` can optionally compute behind a cache lock
(the cache is re-checked after acquiring, the lock is always released, and
concurrent callers execute the callback only once):

```typescript
// config/cache.ts
export default {
  // ...
  remember: {
    lock: true, // enable stampede protection
    lock_seconds: 30, // lock TTL while computing
  },
};
```

### Cache Events

Repositories broadcast Laravel-compatible cache events through the event
dispatcher once the `CacheServiceProvider` wires the `events` service in:
`CacheHit`, `CacheMissed`, `KeyWritten` (put/forever/increment/decrement),
`KeyForgotten`, and `CacheFlushed` - each carrying the store name, key,
value, TTL, and tag names where applicable.

```typescript
import { Event } from '@orchestr-sh/orchestr/Facades';
import { KeyWritten } from '@orchestr-sh/orchestr';

Event.listen(KeyWritten, (event: KeyWritten) => {
  console.log(`[cache:${event.storeName}] wrote ${event.key}`);
});
```

### Custom Cache Drivers

Create custom cache drivers for Memcached, etc.:

```typescript
import type { CacheStore } from '@orchestr-sh/orchestr';

class MemcachedStore implements CacheStore {
  async get(key: string): Promise<any> {
    // Get from Memcached
  }

  async put(key: string, value: any, seconds: number): Promise<boolean> {
    // Put to Memcached
  }

  // Implement other methods...
}

// Register the driver
const manager = app.make<CacheManager>('cache');
manager.registerDriver('memcached', (config) => new MemcachedStore(config));
```

### Repository Methods

The cache repository provides these methods:

```typescript
// Basic operations
await Cache.get(key, defaultValue?)
await Cache.many(keys)
await Cache.put(key, value, ttl?)
await Cache.putMany(values, ttl?)
await Cache.forever(key, value)
await Cache.forget(key)
await Cache.flush()

// High-level operations
await Cache.has(key)
await Cache.missing(key)
await Cache.pull(key, defaultValue?)
await Cache.add(key, value, ttl?)
await Cache.remember(key, ttl, callback)
await Cache.rememberForever(key, callback)
await Cache.flexible(key, [freshTtl, staleTtl], callback)

// Numeric operations
await Cache.increment(key, value?)
await Cache.decrement(key, value?)

// Extend a TTL without changing the value
await Cache.touch(key, seconds?)

// Tags and locks
Cache.tags(names)
Cache.lock(name, seconds?, owner?)
Cache.restoreLock(name, owner)

// Store operations
Cache.store(name?)
Cache.getPrefix()
Cache.setPrefix(prefix)
```

## Task Scheduling

Orchestr ships a Laravel-shaped task scheduler: define recurring closures, console commands, queued jobs, and shell commands once, then fire everything from a single crontab line.

```typescript
* * * * * orchestr schedule:run
```

### Configuration

Register the scheduler (or just resolve `schedule` - the `schedule:*` commands create one on demand):

```typescript
import { ScheduleServiceProvider, Schedule } from '@orchestr-sh/orchestr';

app.register(new ScheduleServiceProvider(app));

const schedule = app.make<Schedule>('schedule');
```

### Defining Schedules

Each registration method returns a fluent `Event`:

```typescript
// Closures
schedule
  .call(() => refreshStatistics(), 'refresh statistics')
  .everyFiveMinutes();

// Console commands (run through the container-bound ConsoleKernel)
schedule.command('report:send', { daily: true }).dailyAt('09:00');

// Queued jobs (instance, or class + constructor args)
schedule.job(new PruneOldRecords()).weeklyOn(0, '02:00');
schedule.job(ProcessUploads, [uploadId]).everyTenMinutes();

// Shell commands
schedule.exec('php pattern_check.php').hourlyAt(30);

// Grouped definitions
schedule.group((group) => {
  group.command('cache:prune').hourly();
  group.command('logs:archive').daily();
});
```

Available frequency helpers: `cron`, `everyMinute`, `everyFiveMinutes`, `everyTenMinutes`, `everyFifteenMinutes`, `everyThirtyMinutes`, `hourly`, `hourlyAt`, `daily`, `dailyAt`, `twiceDaily`, `weekly`, `weeklyOn`, `monthly`, `monthlyOn`, `quarterly`, `yearly`, `weekdays`, `weekends`, `days`, `mondays()`..`sundays`, plus `timezone`, `between`, and `unlessBetween`.

Cron expressions support the five standard fields with `*`, lists (`0,15`), ranges (`1-5`), steps (`*/5`, `1-10/2`, `5/15`), month names (`JAN`-`DEC`), weekday names (`SUN`-`SAT`), Sunday as `0` or `7`, and POSIX day-of-month / day-of-week semantics.

### Task Modifiers

```typescript
schedule
  .command('imports:run')
  .everyFifteenMinutes()
  .withoutOverlapping() // cache lock held for the duration of the run
  .onOneServer() // cache lock keeps other servers from claiming the run
  .runInBackground() // shell tasks detach; closures keep running without blocking
  .evenInMaintenanceMode() // still runs while storage/framework/down exists
  .when((now) => isTradingDay(now)) // conditional execution
  .skip(() => featureDisabled)
  .before((event) => log(`starting ${event.getDescription()}`))
  .onSuccess((event) => notify(`${event.getDescription()} done`))
  .onFailure((error, event) => alert(event.getDescription(), error))
  .after(() => cleanup());
```

`withoutOverlapping()` and `onOneServer()` both take their mutual exclusion from cache locks (the `cache` container binding), so they work across processes and across machines sharing a cache store.

### The `Schedule` Facade

```typescript
import { ScheduleFacade as Schedule } from '@orchestr-sh/orchestr';

Schedule.command('queue:restart').hourly();
const due = Schedule.dueEvents();
```

### Console Commands

| Command | Description |
| ------- | ----------- |
| `schedule:run` | Run all due tasks once (the crontab entry) |
| `schedule:work` | Long-running loop that runs due tasks every minute |
| `schedule:list` | List registered tasks with expressions and next run times (`--timezone=...`) |
| `schedule:test <task>` | Run a specific task immediately, regardless of schedule |

### Programmatic Execution

```typescript
const due = schedule.dueEvents(new Date());
const results = await schedule.run(new Date());

for (const { event, outcome } of results) {
  if (outcome.status === 'failure') console.error(event.getDescription(), outcome.error);
}
```

## View System

Orchestr includes a view system for rendering HTML templates, mirroring Laravel's Blade. Views are stored in `resources/views/` and use dot-notation for resolution (e.g., `'layouts.app'` resolves to `resources/views/layouts/app.html`).

### Configuration

```typescript
import { ViewServiceProvider } from '@orchestr-sh/orchestr';

app.register(new ViewServiceProvider(app));

// Configure in ConfigServiceProvider
{
  view: {
    paths: ['resources/views'],
    extensions: ['.html', '.orchestr.html'],
  },
}
```

### Basic Usage

Return views directly from route handlers using the `view()` helper:

```typescript
import { Route, view } from '@orchestr-sh/orchestr';

Route.get('/', () => {
  return view('welcome', { name: 'World' });
});
```

### View Facade

```typescript
import { ViewFacade as View } from '@orchestr-sh/orchestr';

// Create a view instance
const v = View.make('welcome', { name: 'World' });
const html = await v.render();

// Check if a view exists
if (View.exists('emails.invoice')) {
  // ...
}

// Share data with all views
View.share('appName', 'My App');
```

### Chaining Data

```typescript
const v = view('welcome')
  .with('name', 'John')
  .with({ role: 'admin', active: true });
```

### Template Syntax

**Output:**

```html
{{ variable }}              <!-- HTML-escaped (XSS-safe) -->
{!! variable !!}            <!-- Raw/unescaped output -->
```

**Conditionals:**

```html
@if(user.isAdmin)
  <p>Welcome, admin!</p>
@elseif(user.isMember)
  <p>Welcome, member!</p>
@else
  <p>Welcome, guest!</p>
@endif
```

**Loops:**

```html
@foreach(users as user)
  <li>{{ user.name }}</li>
@endforeach
```

**Includes:**

```html
@include('partials.nav')
@include('partials.alert', { type: 'success' })
```

### Layouts

Define a layout file (`resources/views/layouts/app.html`):

```html
<!DOCTYPE html>
<html>
<head>
  <title>@yield('title', 'My App')</title>
</head>
<body>
  @yield('content')
</body>
</html>
```

Extend it from a child template (`resources/views/welcome.html`):

```html
@extends('layouts.app')

@section('title')Welcome@endsection

@section('content')
  <h1>Hello, {{ name }}!</h1>
@endsection
```

### Response Integration

```typescript
// From a route handler
Route.get('/', (req, res) => {
  return res.view('welcome', { name: 'World' });
});
```

### View Commands

```bash
# Create a new view template
npx orchestr make:view welcome
npx orchestr make:view emails.invoice    # Creates resources/views/emails/invoice.html
```

## Deploying

Orchestr ships zero-dependency deploy tooling around **Symphony**, Orchestr's hosted control plane (`https://symphony.orchestr.sh`) that records projects, servers and deployment history. The actual deployment runs client-side: `orchestr deploy` builds with `npm run build`, tars `dist/` plus manifests, uploads over `scp`, and on the server installs production dependencies, links `shared/.env` and `shared/storage`, swaps the `releases/<timestamp>` → `current` symlink and reloads PM2. `ssh`/`scp` and `pm2` are the only external requirements.

```bash
# One-time: authenticate (email + password; the token is stored in ~/.orchestr/credentials, mode 0600)
npx orchestr deploy:login --email=you@example.com

# Register this project - writes symphony.json ({ "project": "my-app", "api": "..." }) to the repo root
npx orchestr deploy:init --name=my-app --repository=https://github.com/acme/my-app

# Optionally have orchestr set up a fresh Ubuntu box (Node 22, PM2, Nginx, Let's Encrypt, UFW,
# the `orchestr` user and the releases/shared directory layout) over direct root SSH
npx orchestr deploy:provision --host=203.0.113.10 --domain=app.example.com --email=you@example.com

# Register a server (or `deploy:server list` / `deploy:server remove --name=production`)
npx orchestr deploy:server add --host=203.0.113.10 --name=production --user=orchestr --deploy-path=/home/orchestr

# Manage environment variables (stored server-side, linked into each release as shared/.env)
npx orchestr deploy:env list
npx orchestr deploy:env set --key=APP_KEY --value=base64:...
npx orchestr deploy:env push --file=.env.production

# Ship it
npx orchestr deploy                       # build, upload, install, symlink swap, pm2 reload
npx orchestr deploy --migrate             # also runs `npx orchestr migrate` before activation
npx orchestr deploy --server=production   # limit to one server
npx orchestr deploy --no-build            # reuse the existing dist/
npx orchestr deploy:status --limit=5      # recent deployment records (uuid, status, commit, message)
npx orchestr deploy:rollback              # point the project back to the previous active release
```

`deploy:rollback` updates the Symphony record and hands you the release UUID; if PM2 is still running the old release it tells you to re-point the symlink (or just redeploy). Builds are tarballs of `dist/` plus any of `package.json`, lockfiles, `tsconfig.json` and `ecosystem.config.js/.cjs` found in the project root, so adjust `npm run build` to your bundler.

## Features

- ✅ Service Container & Dependency Injection
- ✅ Configuration System (inline + `config/` files + `.env` loading + `config:cache` snapshots)
- ✅ HTTP Router & Middleware
- ✅ Exception Handling (abort, HttpExceptions, JSON/HTML rendering)
- ✅ Sessions & CSRF Protection (array/file/cookie stores, flash data, token verification)
- ✅ Controllers with DI
- ✅ FormRequest Validation
- ✅ Query Builder
- ✅ Ensemble ORM (ActiveRecord)
- ✅ Relationships (Standard + Polymorphic)
- ✅ Eager/Lazy Loading
- ✅ Relationship Existence Queries (`has`, `whereHas`, `whereRelation`, `whereBelongsTo`)
- ✅ Relationship Aggregates (`withCount`, `withSum`, `withExists`, `loadCount`, ...)
- ✅ Pagination (length-aware, simple, and cursor/keyset)
- ✅ API Resources (`JsonResource`, `ResourceCollection`, response wrapping & conditional attributes)
- ✅ Migrations with Schema Builder
- ✅ Database Seeders
- ✅ Model Factories (states, sequences, `has`/`for`, Faker adapter)
- ✅ Events & Listeners
- ✅ Event Subscribers
- ✅ Model Lifecycle Events
- ✅ Event Testing (Fakes & Assertions)
- ✅ Queue System (Jobs, Chains, Batches, Workers, Redis driver, Unique jobs, Testing fakes)
- ✅ Cache System (Tags, Locks, Flexible Caching, Redis store, Cache events)
- ✅ Task Scheduling (cron parser, closures/commands/jobs/shell, overlap & one-server cache locks)
- ✅ View System (Templates, Layouts, Directives)
- ✅ Soft Deletes
- ✅ Attribute Casting
- ✅ Password Hashing (scrypt default, bcrypt/argon2 optional, needsRehash)
- ✅ Encryption (AES-256-GCM payloads, encrypted casts) & Signed URLs
- ✅ Authentication (session + token guards, remember me, Ensemble user provider, auth/guest middleware)
- ✅ Authorization (Gate, policies, `can` middleware, gate-backed validation rules)
- ✅ Filesystem & Uploads (local/public/null disks, path-traversal protection, atomic writes, multipart parsing, UploadedFile storage, upload validation rules)
- ✅ Collections (`Array`-subclass with the Laravel method surface, `EnsembleCollection`) & Support utilities (`Str`, `Arr`, `Number`, global helpers)
- ✅ Timestamps
- ✅ @DynamicRelation Decorator
- ✅ Console Kernel (40+ built-in commands) & Symphony Deploy Tooling (SSH/SCP atomic releases, PM2, provisioning, rollback)

## License

MIT

---

Built with TypeScript. Inspired by Laravel.
