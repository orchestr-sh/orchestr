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

# Create controller
orchestr make:controller UserController
orchestr make:controller Api/UserController --path=app/Http/Controllers
```

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

# Controllers
npx orchestr make:controller <name>         # Create controller (app/Http/Controllers)
npx orchestr make:controller <name> --path=<path>  # Create controller in custom directory

# Queue - Jobs
npx orchestr make:job <name>                # Create job class
npx orchestr make:job <name> --sync         # Create synchronous job

# Queue - Workers
npx orchestr queue:work [connection]        # Start queue worker daemon
npx orchestr queue:work --once              # Process single job and exit
npx orchestr queue:work --queue=high,default  # Process specific queues
npx orchestr queue:work --tries=3           # Set max attempts
npx orchestr queue:work --timeout=90        # Set job timeout
npx orchestr queue:work --sleep=3           # Seconds between checks
npx orchestr queue:work --max-jobs=1000     # Stop after N jobs
npx orchestr queue:work --max-time=3600     # Stop after N seconds
npx orchestr queue:work --memory=128        # Memory limit in MB
npx orchestr queue:work --rest=0            # Rest between jobs (ms)
npx orchestr queue:work --stop-when-empty   # Stop when queue is empty
npx orchestr queue:restart                  # Gracefully restart all workers

# Queue - Failed Jobs
npx orchestr queue:failed                   # List all failed jobs
npx orchestr queue:retry <id>               # Retry specific failed job
npx orchestr queue:retry all                # Retry all failed jobs
npx orchestr queue:forget <id>              # Delete failed job by ID
npx orchestr queue:flush                    # Delete all failed jobs
npx orchestr queue:prune-failed --hours=48  # Prune failed jobs older than N hours

# Queue - Monitoring
npx orchestr queue:monitor <queue> --max=100  # Alert if queue exceeds size
npx orchestr queue:clear [connection] --queue=default  # Clear queue

# Queue - Database Setup
npx orchestr queue:table                    # Create jobs table migration
npx orchestr queue:failed-table             # Create failed_jobs table migration
npx orchestr queue:batches-table            # Create job_batches table migration
npx orchestr queue:prune-batches --hours=24 # Prune batches older than N hours

# Cache
npx orchestr cache:clear [--store=redis]    # Clear all cache or specific store
npx orchestr cache:forget <key> [--store=redis]  # Forget specific cache key
npx orchestr cache:table                    # Create cache table migration

# Views
npx orchestr make:view <name>               # Create view template
```

## Queue System

Orchestr provides a powerful queue system for deferring time-intensive tasks. Jobs can be pushed to various drivers (sync, database), retried on failure, organized into chains and batches, and monitored through a comprehensive CLI.

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
import { Queue, Bus } from '@orchestr-sh/orchestr';

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
```

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
import { Queue } from '@orchestr-sh/orchestr';

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

Extend the queue system with custom drivers:

```typescript
import { QueueDriver } from '@orchestr-sh/orchestr';

class RedisDriver implements QueueDriver {
  async push(job: Job, queue?: string): Promise<string> {
    // Push job to Redis
  }

  async pop(queue?: string): Promise<QueueDriverJob | null> {
    // Pop job from Redis
  }

  // Implement other methods...
}

// Register the driver
const manager = app.make<QueueManager>('queue');
manager.registerDriver('redis', (config) => new RedisDriver(config));
```

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
      null: {
        driver: 'null',
      },
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

# Clear specific store
npx orchestr cache:clear --store=redis

# Forget a specific key
npx orchestr cache:forget key-name

# Forget from specific store
npx orchestr cache:forget key-name --store=redis
```

### Custom Cache Drivers

Create custom cache drivers for Redis, Memcached, etc.:

```typescript
import { Store } from '@orchestr-sh/orchestr';

class RedisStore implements Store {
  async get(key: string): Promise<any> {
    // Get from Redis
  }

  async put(key: string, value: any, seconds: number): Promise<boolean> {
    // Put to Redis
  }

  // Implement other methods...
}

// Register the driver
const manager = app.make<CacheManager>('cache');
manager.registerDriver('redis', (config) => new RedisStore(config));
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

// Tags and locks
Cache.tags(names)
Cache.lock(name, seconds?, owner?)
Cache.restoreLock(name, owner)

// Store operations
Cache.store(name?)
Cache.getPrefix()
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
import { View } from '@orchestr-sh/orchestr';

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
- ✅ Queue System (Jobs, Chains, Batches, Workers)
- ✅ Cache System (Tags, Locks, Flexible Caching)
- ✅ View System (Templates, Layouts, Directives)
- ✅ Soft Deletes
- ✅ Attribute Casting
- ✅ Timestamps
- ✅ @DynamicRelation Decorator

## License

MIT

---

Built with TypeScript. Inspired by Laravel.
