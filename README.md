# Laravel-Next

A 1:1 Laravel replica built in TypeScript. Brings Laravel's elegant syntax and architecture to the TypeScript/Node.js ecosystem.

## Features

Built from the ground up with Laravel's core components:

- **Service Container** - Full IoC container with dependency injection and reflection
- **Service Providers** - Bootstrap and register services
- **HTTP Router** - Laravel-style routing with parameter binding
- **Request/Response** - Elegant HTTP abstractions
- **Middleware** - Global and route-level middleware pipeline
- **Controllers** - MVC architecture support
- **Facades** - Static proxy access to services
- **Application Lifecycle** - Complete Laravel bootstrap process

## Installation

```bash
npm install orchestr reflect-metadata
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
app.boot();

// Create HTTP kernel
const kernel = new Kernel(app);

// Define routes
Route.get('/', async (req, res) => {
  return res.json({ message: 'Hello from Laravel-Next!' });
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
import { Route } from 'orchestr';

// Route facade provides static access to Router
Route.get('/path', handler);
Route.post('/path', handler);
Route.group({ prefix: 'api' }, () => {
  // ...
});
```

## Example Application

Run the example application:

```bash
npm run dev
```

Visit `http://localhost:3000` to see it in action.

Available routes in the example:
- `GET /` - Welcome message
- `GET /users/:id` - Get user by ID
- `GET /search?q=query` - Search with query params
- `POST /users` - Create user
- `GET /api/v1/profile` - Protected route (requires auth header)
- `POST /api/v1/posts` - Create post (protected)
- `GET /posts/:postId/comments/:commentId` - Nested parameters

## Architecture

Laravel-Next follows Laravel's architecture exactly:

```
src/
├── Container/
│   └── Container.ts          # IoC Container with DI
├── Foundation/
│   ├── Application.ts        # Core application class
│   ├── ServiceProvider.ts    # Service provider base
│   └── Http/
│       └── Kernel.ts         # HTTP kernel
├── Routing/
│   ├── Router.ts             # Route registration and dispatch
│   ├── Route.ts              # Individual route
│   ├── Request.ts            # HTTP request wrapper
│   ├── Response.ts           # HTTP response wrapper
│   └── Controller.ts         # Base controller
├── Support/
│   └── Facade.ts             # Facade base class
├── Facades/
│   └── Route.ts              # Route facade
└── Providers/
    └── RouteServiceProvider.ts
```

## TypeScript Benefits

While maintaining Laravel's API, you get:

- **Type Safety** - Full TypeScript type checking
- **Better IDE Support** - Autocomplete and IntelliSense
- **Reflection** - Automatic dependency injection
- **Modern Async** - Native async/await support
- **Performance** - Compiled JavaScript performance

## Roadmap

This is the core foundation. Next components to build:

- [ ] Database Query Builder
- [ ] Eloquent ORM
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

| Feature | Laravel | Laravel-Next |
|---------|---------|--------------|
| Service Container | ✅ | ✅ |
| Service Providers | ✅ | ✅ |
| Routing | ✅ | ✅ |
| Middleware | ✅ | ✅ |
| Controllers | ✅ | ✅ |
| Request/Response | ✅ | ✅ |
| Facades | ✅ | ✅ |
| Eloquent ORM | ✅ | 🚧 |
| Query Builder | ✅ | 🚧 |
| Validation | ✅ | 🚧 |
| Authentication | ✅ | 🚧 |
| Authorization | ✅ | 🚧 |
| Events | ✅ | 🚧 |
| Queues | ✅ | 🚧 |
| Cache | ✅ | 🚧 |
| File Storage | ✅ | 🚧 |
| Mail | ✅ | 🚧 |
| Notifications | ✅ | 🚧 |

## License

MIT
