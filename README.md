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
- **Facades** - Static proxy access to services (Route, DB)
- **Query Builder** - Fluent database query builder with full Laravel API
- **Ensemble ORM** - ActiveRecord ORM (Laravel's Eloquent equivalent) with relationships, soft deletes, and more
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

### Controllers

MVC pattern with base controller:

```typescript
import { Controller, Request, Response, Route } from 'orchestr';

class UserController extends Controller {
  async index(req: Request, res: Response) {
    return res.json({ users: [] });
  }

  async show(req: Request, res: Response) {
    const id = req.routeParam('id');
    return res.json({ user: { id } });
  }

  async store(req: Request, res: Response) {
    const validated = await this.validate(req, {
      name: 'required',
      email: 'required|email',
    });
    return res.status(201).json({ user: validated });
  }
}

// Register controller routes
Route.get('/users', [UserController, 'index']);
Route.get('/users/:id', [UserController, 'show']);
Route.post('/users', [UserController, 'store']);
```

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
import { Ensemble, EnsembleBuilder } from 'orchestr';

// Define a model
class User extends Ensemble {
  protected table = 'users';
  protected fillable = ['name', 'email', 'password'];
  protected hidden = ['password'];
  protected casts = {
    email_verified_at: 'datetime',
    is_admin: 'boolean'
  };
}

// Query using the model
const users = await User.query().where('active', true).get();
const user = await User.query().find(1);

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

// Mass assignment
await User.query().create({
  name: 'John',
  email: 'john@example.com'
});

// Soft deletes
import { softDeletes } from 'orchestr';

class Post extends softDeletes(Ensemble) {
  protected table = 'posts';
}

const post = await Post.query().find(1);
await post.delete(); // Soft delete
await post.restore(); // Restore
await post.forceDelete(); // Permanent delete

// Query only non-deleted
const posts = await Post.query().get();

// Query with trashed
const allPosts = await Post.query().withTrashed().get();

// Query only trashed
const trashedPosts = await Post.query().onlyTrashed().get();

// Timestamps
// Automatically manages created_at and updated_at
class Article extends Ensemble {
  protected table = 'articles';
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
import { Ensemble, softDeletes } from 'orchestr';

export class User extends softDeletes(Ensemble) {
  protected table = 'users';
  protected fillable = ['name', 'email', 'password'];
  protected hidden = ['password'];

  protected casts = {
    email_verified_at: 'datetime',
    is_admin: 'boolean'
  };
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

  // Using Ensemble ORM
  Route.get('/users/:id', async (req, res) => {
    const user = await User.query().find(req.routeParam('id'));

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    return res.json({ user });
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
│   │   └── Concerns/
│   │       ├── HasAttributes.ts  # Attribute handling & casting
│   │       └── HasTimestamps.ts  # Timestamp management
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
- [ ] Model Relationships (HasMany, BelongsTo, etc.)
- [ ] Database Migrations
- [ ] Database Seeding
- [ ] Validation System
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
| Model Relationships | ✅ | 🚧       |
| Migrations | ✅ | 🚧       |
| Seeding | ✅ | 🚧       |
| Validation | ✅ | 🚧       |
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
