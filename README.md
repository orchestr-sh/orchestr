# Orchestr

A Laravel-inspired ORM and framework for TypeScript. Write elegant backend applications with ActiveRecord models (called Ensembles), relationships, query building, and more.

## Installation

```bash
npm install @orchestr-sh/orchestr reflect-metadata drizzle-orm
npm install better-sqlite3 # or your preferred database driver
```

### CLI Setup

After installation, the `orchestr` command will be available in your project via `npx`:

```bash
# Run orchestr commands
npx orchestr make:event UserRegistered
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
import { Application, Kernel, ConfigServiceProvider, Route } from '@orchestr-sh/orchestr';

const app = new Application(process.cwd());

// Configure database
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

await app.boot();

// Define routes
Route.get('/', async (req, res) => {
  return res.json({ message: 'Welcome to Orchestr!' });
});

// Start server
const kernel = new Kernel(app);
kernel.listen(3000);
```

## Models (Ensembles)

Ensembles are ActiveRecord models with a fluent API for querying and relationships.

```typescript
import { Ensemble } from '@orchestr-sh/orchestr';

export class User extends Ensemble {
  protected table = 'users';
  protected fillable = ['name', 'email', 'password'];
  protected hidden = ['password'];
}

// Query
const users = await User.query().where('active', true).get();
const user = await User.find(1);

// Create
const user = await User.create({ name: 'John', email: 'john@example.com' });

// Update
user.name = 'Jane';
await user.save();

// Delete
await user.delete();
```

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

## Migrations

Laravel-style migrations with a fluent Schema builder.

```bash
# Create a migration
npx orchestr make:migration create_users_table --create=users

# Run migrations
npx orchestr migrate

# Rollback last batch
npx orchestr migrate:rollback

# Rollback all migrations
npx orchestr migrate:reset

# Drop all tables and re-run migrations
npx orchestr migrate:fresh

# Rollback and re-run all migrations
npx orchestr migrate:refresh

# Check migration status
npx orchestr migrate:status
```

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
table.id()                          // Auto-incrementing big integer
table.string('name', 255)           // VARCHAR
table.text('bio')                   // TEXT
table.integer('votes')              // INTEGER
table.bigInteger('amount')          // BIGINT
table.decimal('price', 8, 2)        // DECIMAL
table.boolean('active')             // BOOLEAN
table.date('birth_date')            // DATE
table.datetime('published_at')      // DATETIME
table.timestamp('created_at')       // TIMESTAMP
table.timestamps()                  // created_at & updated_at
table.json('metadata')              // JSON
table.uuid('identifier')            // UUID
table.enum('status', ['draft', 'published'])
```

### Column Modifiers

```typescript
table.string('email').nullable()
table.string('email').unique()
table.string('email').default('guest@example.com')
table.integer('votes').unsigned()
table.string('email').index()
```

### Foreign Keys

```typescript
table.bigInteger('user_id').unsigned();
table.foreign('user_id').references('id').on('users').onDelete('cascade');
```

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

## Events and Listeners

Laravel-style event system with listeners, subscribers, and automatic discovery.

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

Listeners handle events with a `handle` method.

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

Or use the Event facade to register listeners dynamically:

```typescript
import { Event } from '@orchestr-sh/orchestr';

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
```

### Dispatching Events

```typescript
import { Event } from '@orchestr-sh/orchestr';

// Dispatch via facade
Event.dispatch(new UserRegistered(user));

// Static dispatch on event class
UserRegistered.dispatch(user);

// Conditional dispatch
UserRegistered.dispatchIf(user.isActive, user);
UserRegistered.dispatchUnless(user.isAdmin, user);

// Dispatch until first non-null response (halting)
const result = UserRegistered.until(user);
if (result === false) {
  // Listener vetoed the operation
}

// Queue events for later
Event.push('user.registered', [user]);
Event.flush('user.registered'); // Dispatch all queued
```

### Event Subscribers

Subscribers listen to multiple events in a single class:

```typescript
import { EventSubscriber, Dispatcher } from '@orchestr-sh/orchestr';

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

Ensemble models automatically dispatch lifecycle events:

```typescript
import { Event, ModelCreated, ModelUpdated, ModelDeleting } from '@orchestr-sh/orchestr';

// Listen to model events
Event.listen(ModelCreated, (event) => {
  console.log('Model created:', event.model);
});

Event.listen(ModelDeleting, (event) => {
  // Prevent deletion by returning false
  if (event.model.isProtected) {
    return false;
  }
});

// Listen to specific model events using wildcards
Event.listen('User.*', (event) => {
  // Handles all User model events
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

### Testing Events

Use `Event.fake()` to test event dispatching:

```typescript
import { Event } from '@orchestr-sh/orchestr';

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
```

## Controllers

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

## Configuration

### Database Setup

```typescript
import { DatabaseServiceProvider, DatabaseManager, DrizzleAdapter } from '@orchestr-sh/orchestr';

export class DatabaseServiceProvider extends ServiceProvider {
  register(): void {
    this.app.singleton('db', () => {
      const config = this.app.make('config').get('database');
      const manager = new DatabaseManager(config);
      manager.registerAdapter('drizzle', (config) => new DrizzleAdapter(config));
      return manager;
    });
  }

  async boot(): Promise<void> {
    const db = this.app.make('db');
    await db.connection().connect();
    Ensemble.setConnectionResolver(db);
  }
}

// Register in your app
app.register(DatabaseServiceProvider);
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
user.save()               // Save changes
user.delete()             // Delete record
user.refresh()            // Reload from database
user.load('posts')        // Lazy load relationship
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

All commands should be run with `npx orchestr` (or just `orchestr` if installed globally):

```bash
# Migrations
npx orchestr make:migration <name>          # Create migration
npx orchestr make:migration <name> --create=<table>  # Create table migration
npx orchestr make:migration <name> --table=<table>   # Update table migration
npx orchestr migrate                        # Run migrations
npx orchestr migrate:rollback               # Rollback last batch
npx orchestr migrate:reset                  # Rollback all migrations
npx orchestr migrate:refresh                # Reset and re-run migrations
npx orchestr migrate:fresh                  # Drop all tables and migrate
npx orchestr migrate:status                 # Show migration status

# Seeders
npx orchestr make:seeder <name>             # Create seeder
npx orchestr db:seed                        # Run DatabaseSeeder
npx orchestr db:seed --class=<name>         # Run specific seeder

# Events & Listeners
npx orchestr make:event <name>              # Create event
npx orchestr make:listener <name>           # Create listener
npx orchestr make:listener <name> --event=<EventName>  # Create listener for event
npx orchestr make:listener <name> --queued  # Create queued listener
npx orchestr event:list                     # List all registered events
npx orchestr event:cache                    # Cache discovered events
npx orchestr event:clear                    # Clear event cache
```

## Features

- ✅ Service Container & Dependency Injection
- ✅ Configuration System
- ✅ HTTP Router & Middleware
- ✅ Controllers with DI
- ✅ FormRequest Validation
- ✅ Query Builder
- ✅ Ensemble ORM (ActiveRecord)
- ✅ Relationships (Standard + Polymorphic)
- ✅ Eager/Lazy Loading
- ✅ Migrations with Schema Builder
- ✅ Database Seeders
- ✅ Events & Listeners
- ✅ Event Subscribers
- ✅ Model Lifecycle Events
- ✅ Event Testing (Fakes & Assertions)
- ✅ Soft Deletes
- ✅ Attribute Casting
- ✅ Timestamps
- ✅ @DynamicRelation Decorator

## License

MIT

---

Built with TypeScript. Inspired by Laravel.
