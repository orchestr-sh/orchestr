# Orchestr

A 1:1 Laravel replica built in TypeScript. Brings Laravel's elegant syntax and architecture to the TypeScript/Node.js ecosystem.

## Features

Built from the ground up with Laravel's core components:

- **Service Container** - Full IoC container with dependency injection and reflection
- **Service Providers** - Bootstrap and register services
- **HTTP Router** - Laravel-style routing with parameter binding and file-based route loading
- **Request/Response** - Elegant HTTP abstractions
- **Middleware** - Global and route-level middleware pipeline
- **Controllers** - MVC architecture support
- **FormRequest** - Laravel-style validation and authorization
- **Facades** - Static proxy access to services (Route, DB)
- **Query Builder** - Fluent database query builder with full Laravel API
- **Ensemble ORM** - ActiveRecord ORM (Laravel's Eloquent equivalent) with relationships (HasOne, HasMany, BelongsTo), eager/lazy loading, soft deletes, and more
- **Database Manager** - Multi-connection database management
- **Application Lifecycle** - Complete Laravel bootstrap process

## Installation

```bash
npm install @orchestr-sh/orchestr reflect-metadata
```

**Note**: `reflect-metadata` is required for dependency injection to work.

## Quick Start

```typescript
import 'reflect-metadata'; // Must be first!
import { Application, Kernel, RouteServiceProvider, Route } from 'orchestr';

// Create application
const app = new Application(__dirname);

// Register providers
app.register(RouteServiceProvider);
await app.boot();

// Create HTTP kernel
const kernel = new Kernel(app);

// Define routes
Route.get('/', async (req, res) => {
  return res.json({ message: 'Hello from Orchestr!' });
});

Route.get('/users/:id', async (req, res) => {
  const id = req.routeParam('id');
  return res.json({ user: { id, name: 'John Doe' } });
});

Route.post('/users', async (req, res) => {
  const data = req.only(['name', 'email']);
  return res.status(201).json({ user: data });
});

// Start server
kernel.listen(3000);
```

## Core Concepts

### Service Container

Laravel's IoC container provides powerful dependency injection:

```typescript
// Bind a service
app.bind('UserService', () => new UserService());

// Bind a singleton
app.singleton('Database', () => new Database());

// Resolve from container
const userService = app.make('UserService');
```

### Dependency Injection

Orchestr supports automatic constructor-based dependency injection using TypeScript's reflection:

```typescript
import { Injectable, Controller, Request, Response } from 'orchestr';

// Define a service
export class UserService {
  getUsers() {
    return [{ id: 1, name: 'John' }];
  }
}

// Use @Injectable() decorator to enable DI
@Injectable()
export class UserController extends Controller {
  // Dependencies are automatically injected
  constructor(private userService: UserService) {
    super();
  }

  async index(req: Request, res: Response) {
    const users = this.userService.getUsers();
    return res.json({ users });
  }
}

// Register the service in a provider
class AppServiceProvider extends ServiceProvider {
  register(): void {
    // Bind the service to the container
    this.app.singleton(UserService, () => new UserService());
  }
}
```

**Important**: The `@Injectable()` decorator is required for dependency injection to work. It triggers TypeScript to emit metadata about constructor parameters.

### Service Providers

Organize service registration and bootstrapping:

```typescript
class AppServiceProvider extends ServiceProvider {
  register(): void {
    this.app.singleton('config', () => ({ /* config */ }));
  }

  boot(): void {
    // Bootstrap code
  }
}

app.register(AppServiceProvider);
```

### Routing

Laravel-style routing with full parameter support:

```typescript
// Simple routes
Route.get('/users', handler);
Route.post('/users', handler);
Route.put('/users/:id', handler);
Route.delete('/users/:id', handler);

// Route parameters
Route.get('/users/:id/posts/:postId', async (req, res) => {
  const userId = req.routeParam('id');
  const postId = req.routeParam('postId');
});

// Route groups
Route.group({ prefix: 'api/v1', middleware: authMiddleware }, () => {
  Route.get('/profile', handler);
  Route.post('/posts', handler);
});

// Named routes
const route = Route.get('/users', handler);
route.setName('users.index');
```

#### Loading Routes from Files

Organize your routes in separate files, just like Laravel:

**routes/web.ts**
```typescript
import { Route } from 'orchestr';

Route.get('/', async (req, res) => {
  return res.json({ message: 'Welcome' });
});

Route.get('/about', async (req, res) => {
  return res.json({ page: 'about' });
});
```

**routes/api.ts**
```typescript
import { Route } from 'orchestr';

Route.group({ prefix: 'api/v1' }, () => {
  Route.get('/users', async (req, res) => {
    return res.json({ users: [] });
  });

  Route.post('/users', async (req, res) => {
    return res.status(201).json({ created: true });
  });
});
```

**app/Providers/AppRouteServiceProvider.ts**
```typescript
import { RouteServiceProvider } from 'orchestr';

export class AppRouteServiceProvider extends RouteServiceProvider {
  async boot(): Promise<void> {
    // Load web routes
    this.routes(() => import('../../routes/web'));

    // Load API routes
    this.routes(() => import('../../routes/api'));

    await super.boot();
  }
}
```

**index.ts**
```typescript
import 'reflect-metadata';
import { Application, Kernel } from 'orchestr';
import { AppRouteServiceProvider } from './app/Providers/AppRouteServiceProvider';

const app = new Application(__dirname);
app.register(AppRouteServiceProvider);
await app.boot();

const kernel = new Kernel(app);
kernel.listen(3000);
```

### Middleware

Global and route-level middleware:

```typescript
// Global middleware
kernel.use(async (req, res, next) => {
  console.log(`${req.method} ${req.path}`);
  await next();
});

// Route middleware
const authMiddleware = async (req, res, next) => {
  if (!req.header('authorization')) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  await next();
};

Route.get('/profile', handler).addMiddleware(authMiddleware);
```

### FormRequest Validation

Laravel-style FormRequest for clean validation and authorization:

```typescript
import { FormRequest, ValidationRules, ValidationException, Route, Request, Response } from 'orchestr';

// Create a FormRequest class
export class StoreUserRequest extends FormRequest {
  // Authorize the request
  protected authorize(): boolean {
    return this.request.header('authorization') !== undefined;
  }

  // Define validation rules
  protected rules(): ValidationRules {
    return {
      name: 'required|string|min:3|max:255',
      email: 'required|email',
      password: 'required|string|min:8|confirmed',
      age: 'numeric|min:18|max:120',
      role: 'required|in:user,admin,moderator',
    };
  }

  // Custom error messages
  protected messages(): Record<string, string> {
    return {
      'name.required': 'Please provide your full name.',
      'email.email': 'Please provide a valid email address.',
      'password.min': 'Password must be at least 8 characters.',
    };
  }
}

// Use in routes
Route.post('/users', async (req: Request, res: Response) => {
  try {
    // Validate request (checks authorization AND validation)
    const formRequest = await StoreUserRequest.validate(StoreUserRequest, req, res);

    // Get validated data only
    const validated = formRequest.validated();

    // Create user with safe, validated data
    const user = await User.create(validated);

    return res.status(201).json({ user });
  } catch (error) {
    // Validation/authorization errors already handled
    if (error instanceof ValidationException) return;
    throw error;
  }
});
```

**See [FORM_REQUESTS.md](./FORM_REQUESTS.md) for complete documentation.**

### Controllers

MVC pattern with base controller and dependency injection:

```typescript
import { Injectable, Controller, Request, Response, Route } from 'orchestr';

// Use @Injectable() when injecting dependencies
@Injectable()
class UserController extends Controller {
  // Services are automatically injected
  constructor(private userService: UserService) {
    super();
  }

  async index(req: Request, res: Response) {
    const users = await this.userService.getAll();
    return res.json({ users });
  }

  async show(req: Request, res: Response) {
    const id = req.routeParam('id');
    const user = await this.userService.findById(id);
    return res.json({ user });
  }

  async store(req: Request, res: Response) {
    const validated = await this.validate(req, {
      name: 'required',
      email: 'required|email',
    });
    const user = await this.userService.create(validated);
    return res.status(201).json({ user });
  }
}

// Register controller routes
Route.get('/users', [UserController, 'index']);
Route.get('/users/:id', [UserController, 'show']);
Route.post('/users', [UserController, 'store']);
```

**Note**: The `@Injectable()` decorator must be used on any class that needs constructor dependency injection. Without it, TypeScript won't emit the metadata needed for automatic resolution.

### Request

Powerful request helper methods:

```typescript
// Get input
req.input('name');
req.get('email', 'default@example.com');

// Get all inputs
req.all();

// Get specific inputs
req.only(['name', 'email']);
req.except(['password']);

// Check input existence
req.has('name');
req.filled('email');

// Route parameters
req.routeParam('id');

// Headers
req.header('content-type');
req.expectsJson();
req.ajax();

// Request info
req.method;
req.path;
req.ip();
```

### Response

Fluent response building:

```typescript
// JSON responses
res.json({ data: [] });
res.status(201).json({ created: true });

// Headers
res.header('X-Custom', 'value');
res.headers({ 'X-A': 'a', 'X-B': 'b' });

// Cookies
res.cookie('token', 'value', { httpOnly: true, maxAge: 3600 });

// Redirects
res.redirect('/home');
res.redirect('/login', 301);

// Downloads
res.download(buffer, 'file.pdf');

// Views (simplified)
res.view('welcome', { name: 'John' });
```

### Facades

Static access to services:

```typescript
import { Route, DB } from 'orchestr';

// Route facade provides static access to Router
Route.get('/path', handler);
Route.post('/path', handler);
Route.group({ prefix: 'api' }, () => {
  // ...
});

// DB facade provides static access to DatabaseManager
const users = await DB.table('users').where('active', true).get();
```

### Database Query Builder

Fluent, chainable query builder with full Laravel API:

```typescript
import { DB } from 'orchestr';

// Basic queries
const users = await DB.table('users').get();
const user = await DB.table('users').where('id', 1).first();

// Where clauses
await DB.table('users')
  .where('votes', '>', 100)
  .where('status', 'active')
  .get();

// Or where
await DB.table('users')
  .where('votes', '>', 100)
  .orWhere('name', 'John')
  .get();

// Additional where methods
await DB.table('users').whereBetween('votes', [1, 100]).get();
await DB.table('users').whereIn('id', [1, 2, 3]).get();
await DB.table('users').whereNull('deleted_at').get();

// Ordering, grouping, and limits
await DB.table('users')
  .orderBy('name', 'desc')
  .groupBy('account_id')
  .having('account_id', '>', 100)
  .limit(10)
  .offset(20)
  .get();

// Joins
await DB.table('users')
  .join('contacts', 'users.id', '=', 'contacts.user_id')
  .leftJoin('orders', 'users.id', '=', 'orders.user_id')
  .select('users.*', 'contacts.phone', 'orders.price')
  .get();

// Aggregates
const count = await DB.table('users').count();
const max = await DB.table('orders').max('price');
const min = await DB.table('orders').min('price');
const avg = await DB.table('orders').avg('price');
const sum = await DB.table('orders').sum('price');

// Inserts
await DB.table('users').insert({
  name: 'John',
  email: 'john@example.com'
});

// Updates
await DB.table('users')
  .where('id', 1)
  .update({ votes: 1 });

// Deletes
await DB.table('users').where('votes', '<', 100).delete();

// Raw expressions
await DB.table('users')
  .select(DB.raw('count(*) as user_count, status'))
  .where('status', '<>', 1)
  .groupBy('status')
  .get();
```

### Ensemble ORM

ActiveRecord ORM (Eloquent equivalent) with relationships and advanced features:

```typescript
import { Ensemble, HasOne, HasMany, BelongsTo, softDeletes } from 'orchestr';

// Define models with relationships
class User extends Ensemble {
  protected table = 'users';
  protected fillable = ['name', 'email', 'password'];
  protected hidden = ['password'];
  protected casts = {
    email_verified_at: 'datetime',
    is_admin: 'boolean'
  };

  // One-to-One: User has one profile
  profile(): HasOne<Profile, User> {
    return this.hasOne(Profile);
  }

  // One-to-Many: User has many posts
  posts(): HasMany<Post, User> {
    return this.hasMany(Post);
  }
}

class Profile extends Ensemble {
  protected table = 'profiles';

  // Belongs To: Profile belongs to user
  user(): BelongsTo<User, Profile> {
    return this.belongsTo(User);
  }
}

class Post extends Ensemble {
  protected table = 'posts';

  // Belongs To: Post belongs to author (user)
  author(): BelongsTo<User, Post> {
    return this.belongsTo(User, 'user_id');
  }

  // One-to-Many: Post has many comments
  comments(): HasMany<Comment, Post> {
    return this.hasMany(Comment);
  }
}

// Query using the model
const users = await User.query().where('active', true).get();
const user = await User.query().find(1);

// Lazy loading relationships
await user.load('posts');
await user.load(['posts', 'profile']);
const posts = user.getRelation('posts');

// Eager loading (solves N+1 problem)
const users = await User.query()
  .with(['posts.comments', 'profile'])
  .get();

// Eager load with constraints
const users = await User.query()
  .with({
    posts: (query) => query.where('published', '=', true)
  })
  .get();

// Create related models
const post = await user.posts().create({
  title: 'My Post',
  content: 'Content here'
});

// Associate/dissociate (BelongsTo)
const post = new Post();
post.author().associate(user);
await post.save();

// Create
const user = new User();
user.name = 'John Doe';
user.email = 'john@example.com';
await user.save();

// Or use create
const user = await User.query().create({
  name: 'John Doe',
  email: 'john@example.com'
});

// Update
const user = await User.query().find(1);
user.name = 'Jane Doe';
await user.save();

// Delete
await user.delete();

// Soft deletes
class Article extends softDeletes(Ensemble) {
  protected table = 'articles';
}

const article = await Article.query().find(1);
await article.delete(); // Soft delete
await article.restore(); // Restore
await article.forceDelete(); // Permanent delete

// Query only non-deleted
const articles = await Article.query().get();

// Query with trashed
const allArticles = await Article.query().withTrashed().get();

// Query only trashed
const trashedArticles = await Article.query().onlyTrashed().get();

// Timestamps
// Automatically manages created_at and updated_at
class Post extends Ensemble {
  protected table = 'posts';
  public timestamps = true; // enabled by default
}

// Custom attributes and casts
class User extends Ensemble {
  protected casts = {
    email_verified_at: 'datetime',
    settings: 'json',
    is_admin: 'boolean',
    age: 'number'
  };

  // Accessors
  getFullNameAttribute(): string {
    return `${this.getAttribute('first_name')} ${this.getAttribute('last_name')}`;
  }

  // Mutators
  setPasswordAttribute(value: string): void {
    this.setAttribute('password', hashPassword(value));
  }
}

const user = await User.query().find(1);
console.log(user.full_name); // Uses accessor
user.password = 'secret123'; // Uses mutator
```

**See [RELATIONSHIPS.md](./RELATIONSHIPS.md) for complete relationship documentation.**

### Database Setup

Configure multiple database connections:

```typescript
import { Application, DatabaseServiceProvider, DB } from 'orchestr';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';

const app = new Application(__dirname);

// Register database service provider
app.register(new DatabaseServiceProvider({
  default: 'sqlite',
  connections: {
    sqlite: {
      adapter: 'drizzle',
      client: drizzle(new Database('database.sqlite'))
    },
    postgres: {
      adapter: 'drizzle',
      client: drizzle(process.env.DATABASE_URL!)
    }
  }
}));

await app.boot();

// Use default connection
const users = await DB.table('users').get();

// Use specific connection
const posts = await DB.connection('postgres').table('posts').get();
```

## Complete Example

Here's a complete example showing routing, database, and ORM:

**index.ts**
```typescript
import 'reflect-metadata';
import { Application, Kernel, DatabaseServiceProvider } from 'orchestr';
import { AppRouteServiceProvider } from './app/Providers/AppRouteServiceProvider';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';

const app = new Application(__dirname);

// Register database
app.register(new DatabaseServiceProvider({
  default: 'sqlite',
  connections: {
    sqlite: {
      adapter: 'drizzle',
      client: drizzle(new Database('database.sqlite'))
    }
  }
}));

// Register routes
app.register(AppRouteServiceProvider);

await app.boot();

const kernel = new Kernel(app);
kernel.listen(3000);
```

**app/Models/User.ts**
```typescript
import { Ensemble, HasMany, softDeletes } from 'orchestr';
import { Post } from './Post';

export class User extends softDeletes(Ensemble) {
  protected table = 'users';
  protected fillable = ['name', 'email', 'password'];
  protected hidden = ['password'];

  protected casts = {
    email_verified_at: 'datetime',
    is_admin: 'boolean'
  };

  // Define relationship
  posts(): HasMany<Post, User> {
    return this.hasMany(Post);
  }
}
```

**app/Models/Post.ts**
```typescript
import { Ensemble, BelongsTo } from 'orchestr';
import { User } from './User';

export class Post extends Ensemble {
  protected table = 'posts';
  protected fillable = ['user_id', 'title', 'content', 'published_at'];

  author(): BelongsTo<User, Post> {
    return this.belongsTo(User, 'user_id');
  }
}
```

**routes/api.ts**
```typescript
import { Route, DB } from 'orchestr';
import { User } from '../app/Models/User';

Route.group({ prefix: 'api' }, () => {
  // Using query builder
  Route.get('/users', async (req, res) => {
    const users = await DB.table('users')
      .where('active', true)
      .orderBy('created_at', 'desc')
      .get();

    return res.json({ users });
  });

  // Using Ensemble ORM with eager loading
  Route.get('/users/:id', async (req, res) => {
    const user = await User.query()
      .with('posts')
      .find(req.routeParam('id'));

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    return res.json({ user: user.toObject() });
  });

  Route.post('/users', async (req, res) => {
    const user = await User.query().create(
      req.only(['name', 'email', 'password'])
    );

    return res.status(201).json({ user });
  });

  Route.delete('/users/:id', async (req, res) => {
    const user = await User.query().find(req.routeParam('id'));
    await user?.delete(); // Soft delete

    return res.json({ message: 'User deleted' });
  });
});
```

## Architecture

Orchestr follows Laravel's architecture exactly:

```
src/
├── Container/
│   └── Container.ts              # IoC Container with DI
├── Foundation/
│   ├── Application.ts            # Core application class
│   ├── ServiceProvider.ts        # Service provider base
│   └── Http/
│       └── Kernel.ts             # HTTP kernel
├── Routing/
│   ├── Router.ts                 # Route registration and dispatch
│   ├── Route.ts                  # Individual route
│   ├── Request.ts                # HTTP request wrapper
│   ├── Response.ts               # HTTP response wrapper
│   └── Controller.ts             # Base controller
├── Database/
│   ├── DatabaseManager.ts        # Multi-connection manager
│   ├── Connection.ts             # Database connection
│   ├── Query/
│   │   ├── Builder.ts            # Query builder
│   │   └── Expression.ts         # Raw SQL expressions
│   ├── Ensemble/
│   │   ├── Ensemble.ts           # Base ORM model (like Eloquent)
│   │   ├── EnsembleBuilder.ts    # Model query builder
│   │   ├── EnsembleCollection.ts # Model collection
│   │   ├── SoftDeletes.ts        # Soft delete trait
│   │   ├── Relations/
│   │   │   ├── Relation.ts       # Base relation class
│   │   │   ├── HasOne.ts         # One-to-one relationship
│   │   │   ├── HasMany.ts        # One-to-many relationship
│   │   │   └── BelongsTo.ts      # Inverse relationship
│   │   └── Concerns/
│   │       ├── HasAttributes.ts  # Attribute handling & casting
│   │       ├── HasTimestamps.ts  # Timestamp management
│   │       └── HasRelationships.ts # Relationship functionality
│   ├── Adapters/
│   │   └── DrizzleAdapter.ts     # Drizzle ORM adapter
│   └── DatabaseServiceProvider.ts
├── Support/
│   ├── Facade.ts                 # Facade base class
│   └── helpers.ts                # Helper functions
├── Facades/
│   ├── Route.ts                  # Route facade
│   └── DB.ts                     # Database facade
└── Providers/
    └── RouteServiceProvider.ts   # Route service provider
```

## TypeScript Benefits

While maintaining Laravel's API, you get:

- **Type Safety** - Full TypeScript type checking
- **Better IDE Support** - Autocomplete and IntelliSense
- **Reflection** - Automatic dependency injection
- **Modern Async** - Native async/await support
- **Performance** - Compiled JavaScript performance

## Roadmap

Core components completed and in progress:

- [x] Service Container & Dependency Injection
- [x] Service Providers
- [x] HTTP Router & Route Files
- [x] Request/Response
- [x] Middleware Pipeline
- [x] Controllers
- [x] Facades (Route, DB)
- [x] Database Query Builder
- [x] Ensemble ORM (Eloquent equivalent)
- [x] Multi-connection Database Manager
- [x] Soft Deletes
- [x] Model Attributes & Casting
- [x] Model Relationships (HasOne, HasMany, BelongsTo)
- [x] Eager/Lazy Loading
- [x] FormRequest Validation & Authorization
- [ ] Many-to-Many Relationships (BelongsToMany)
- [ ] Relationship Queries (has, whereHas, withCount)
- [ ] Polymorphic Relationships
- [ ] Database Migrations
- [ ] Database Seeding
- [ ] Authentication & Authorization
- [ ] Queue System
- [ ] Events & Listeners
- [ ] File Storage
- [ ] Cache System
- [ ] Template Engine (Blade equivalent)
- [ ] CLI/Artisan equivalent
- [ ] Testing utilities

## Comparison to Laravel

| Feature | Laravel | Orchestr |
|---------|---------|----------|
| Service Container | ✅ | ✅        |
| Service Providers | ✅ | ✅        |
| Routing | ✅ | ✅        |
| Route Files | ✅ | ✅        |
| Middleware | ✅ | ✅        |
| Controllers | ✅ | ✅        |
| Request/Response | ✅ | ✅        |
| Facades | ✅ | ✅        |
| Query Builder | ✅ | ✅        |
| Eloquent ORM | ✅ | ✅ (Ensemble)       |
| Soft Deletes | ✅ | ✅        |
| Timestamps | ✅ | ✅        |
| Attribute Casting | ✅ | ✅        |
| Basic Relationships | ✅ | ✅        |
| Eager/Lazy Loading | ✅ | ✅        |
| Many-to-Many | ✅ | 🚧       |
| Polymorphic Relations | ✅ | 🚧       |
| Migrations | ✅ | 🚧       |
| Seeding | ✅ | 🚧       |
| FormRequest Validation | ✅ | ✅        |
| Authentication | ✅ | 🚧       |
| Authorization | ✅ | 🚧       |
| Events | ✅ | 🚧       |
| Queues | ✅ | 🚧       |
| Cache | ✅ | 🚧       |
| File Storage | ✅ | 🚧       |
| Mail | ✅ | 🚧       |
| Notifications | ✅ | 🚧       |

## License

MIT
