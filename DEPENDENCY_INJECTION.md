# Dependency Injection Guide

This guide explains how to use dependency injection in Orchestr and troubleshoot common issues.

## Table of Contents

- [How It Works](#how-it-works)
- [Quick Start](#quick-start)
- [Common Issues](#common-issues)
- [Debugging](#debugging)
- [Advanced Usage](#advanced-usage)

---

## How It Works

Orchestr uses TypeScript's `reflect-metadata` and decorator metadata to automatically resolve constructor dependencies. When you bind a service to the container and use the `@Injectable()` decorator, the framework automatically injects dependencies.

### The Flow

1. **Bind services** to the container via service providers
2. **Decorate classes** with `@Injectable()` that need dependency injection
3. **Type hint** constructor parameters
4. The container **automatically resolves and injects** dependencies when creating instances

---

## Quick Start

### 1. Ensure Prerequisites

**tsconfig.json:**
```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "target": "ES2022"
  }
}
```

**Entry file (index.ts):**
```typescript
import 'reflect-metadata'; // ← MUST BE FIRST LINE
import { Application } from 'orchestr';
// ... rest of your imports
```

### 2. Create a Service

```typescript
// app/Services/UserService.ts
export class UserService {
  async getUsers() {
    return [
      { id: 1, name: 'John Doe' },
      { id: 2, name: 'Jane Smith' }
    ];
  }

  async findById(id: string) {
    return { id, name: 'John Doe' };
  }
}
```

### 3. Register the Service

```typescript
// app/Providers/AppServiceProvider.ts
import { ServiceProvider } from 'orchestr';
import { UserService } from '../Services/UserService';

export class AppServiceProvider extends ServiceProvider {
  register(): void {
    // Singleton (shared instance)
    this.app.singleton(UserService, () => new UserService());

    // OR Transient (new instance each time)
    // this.app.bind(UserService, () => new UserService());
  }
}
```

### 4. Use the `@Injectable()` Decorator

```typescript
// app/Controllers/UserController.ts
import { Injectable, Controller, Request, Response } from 'orchestr';
import { UserService } from '../Services/UserService';

@Injectable() // ← REQUIRED for dependency injection
export class UserController extends Controller {
  constructor(private userService: UserService) {
    super();
  }

  async index(req: Request, res: Response) {
    const users = await this.userService.getUsers();
    return res.json({ users });
  }

  async show(req: Request, res: Response) {
    const id = req.routeParam('id');
    const user = await this.userService.findById(id);
    return res.json({ user });
  }
}
```

### 5. Bootstrap the Application

```typescript
// index.ts
import 'reflect-metadata';
import { Application, Kernel } from 'orchestr';
import { AppServiceProvider } from './app/Providers/AppServiceProvider';
import { AppRouteServiceProvider } from './app/Providers/AppRouteServiceProvider';

const app = new Application(__dirname);

// Register service providers
app.register(AppServiceProvider);
app.register(AppRouteServiceProvider);

// Boot the application
await app.boot();

// Start the HTTP kernel
const kernel = new Kernel(app);
kernel.listen(3000);
```

---

## Common Issues

### Issue 1: `undefined is not an object (evaluating 'this.service.foo')`

**Cause:** Service is injected as `undefined`.

**Solutions:**

#### A. Missing `@Injectable()` Decorator

```typescript
// ❌ WRONG - No decorator
export class UserController extends Controller {
  constructor(private userService: UserService) {
    super();
  }
}

// ✅ CORRECT - Has decorator
@Injectable()
export class UserController extends Controller {
  constructor(private userService: UserService) {
    super();
  }
}
```

#### B. Service Not Bound to Container

```typescript
// Make sure the service is registered in a provider
export class AppServiceProvider extends ServiceProvider {
  register(): void {
    // Add this binding
    this.app.singleton(UserService, () => new UserService());
  }
}
```

#### C. Missing `reflect-metadata` Import

```typescript
// ❌ WRONG - reflect-metadata not first
import { Application } from 'orchestr';
import 'reflect-metadata';

// ✅ CORRECT - reflect-metadata is first
import 'reflect-metadata';
import { Application } from 'orchestr';
```

### Issue 2: `Cannot resolve dependency at position 0`

**Cause:** TypeScript didn't emit metadata for the constructor parameter.

**Solution:** Add the `@Injectable()` decorator:

```typescript
@Injectable()
export class YourClass {
  constructor(private service: ServiceType) {}
}
```

### Issue 3: Circular Dependencies

**Cause:** Service A depends on Service B, which depends on Service A.

**Solution:** Refactor to break the circular dependency or use property injection:

```typescript
@Injectable()
export class ServiceA {
  private serviceB!: ServiceB;

  constructor(private container: Container) {}

  init() {
    // Lazy resolution
    this.serviceB = this.container.make(ServiceB);
  }
}
```

### Issue 4: Metadata Shows `undefined` or `Object`

**Cause:** TypeScript compiler settings are incorrect.

**Solution:** Verify `tsconfig.json`:

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,     // ← Must be true
    "emitDecoratorMetadata": true,      // ← Must be true
    "target": "ES2022"                  // ← ES2015 or higher
  }
}
```

---

## Debugging

### Check Constructor Metadata

```typescript
import 'reflect-metadata';
import { UserController } from './app/Controllers/UserController';

const metadata = Reflect.getMetadata('design:paramtypes', UserController);
console.log('Constructor parameter types:', metadata);

// Expected output:
// Constructor parameter types: [Function: UserService]

// Problem if you see:
// Constructor parameter types: undefined  ← Missing @Injectable()
// Constructor parameter types: [Object]   ← Wrong tsconfig.json
```

### Check Container Bindings

```typescript
// After app.boot()
const app = new Application(__dirname);
app.register(AppServiceProvider);
await app.boot();

// Debug bindings
console.log('Bound services:', Array.from((app as any).bindings.keys()));
// Should include your service classes
```

### Check Resolved Instances

```typescript
// Debug singletons
console.log('Resolved instances:', Array.from((app as any).instances.keys()));
```

### Add Constructor Logging

```typescript
@Injectable()
export class UserController extends Controller {
  constructor(private userService: UserService) {
    super();
    console.log('UserService injected:', this.userService);
    console.log('UserService type:', typeof this.userService);
    console.log('Has getUsers method?', typeof this.userService?.getUsers);
  }
}
```

---

## Advanced Usage

### Multiple Services

```typescript
@Injectable()
export class OrderController extends Controller {
  constructor(
    private userService: UserService,
    private orderService: OrderService,
    private emailService: EmailService
  ) {
    super();
  }

  async create(req: Request, res: Response) {
    const user = await this.userService.findById(req.input('userId'));
    const order = await this.orderService.create(req.all());
    await this.emailService.sendOrderConfirmation(user, order);
    return res.status(201).json({ order });
  }
}
```

### Factory Functions with Dependencies

```typescript
export class AppServiceProvider extends ServiceProvider {
  register(): void {
    // Simple singleton
    this.app.singleton(DatabaseService, () => new DatabaseService());

    // Factory with dependencies
    this.app.singleton(UserRepository, () => {
      const db = this.app.make(DatabaseService);
      return new UserRepository(db);
    });

    // Factory with configuration
    this.app.singleton(EmailService, () => {
      const config = this.app.make('config');
      return new EmailService(config.email);
    });
  }
}
```

### Singleton vs Transient

```typescript
export class AppServiceProvider extends ServiceProvider {
  register(): void {
    // Singleton - Same instance shared across all requests
    this.app.singleton(DatabaseService, () => new DatabaseService());

    // Transient - New instance for each injection
    this.app.bind(RequestLogger, () => new RequestLogger());
  }
}
```

**When to use:**
- **Singleton:** Database connections, configuration, caches, stateless services
- **Transient:** Request-scoped services, services with mutable state

### Instance Binding

```typescript
export class AppServiceProvider extends ServiceProvider {
  register(): void {
    // Register an already-created instance
    const config = loadConfig();
    this.app.instance('config', config);

    // Or bind a class instance
    const logger = new Logger({ level: 'debug' });
    this.app.instance(Logger, logger);
  }
}
```

### Aliasing

```typescript
export class AppServiceProvider extends ServiceProvider {
  register(): void {
    this.app.singleton(UserService, () => new UserService());

    // Create an alias
    this.app.alias(UserService, 'users');
  }
}

// Can now resolve by either name
const service1 = app.make(UserService);
const service2 = app.make('users');
// service1 === service2 (same instance)
```

### Nested Dependencies

Services can have their own dependencies:

```typescript
export class OrderService {
  constructor(
    private userService: UserService,
    private paymentService: PaymentService
  ) {}
}

@Injectable()
export class OrderController extends Controller {
  // OrderService dependencies are automatically resolved
  constructor(private orderService: OrderService) {
    super();
  }
}

// Register all services
export class AppServiceProvider extends ServiceProvider {
  register(): void {
    this.app.singleton(UserService, () => new UserService());
    this.app.singleton(PaymentService, () => new PaymentService());
    this.app.singleton(OrderService, () => new OrderService());
    // Container automatically resolves nested dependencies
  }
}
```

---

## Best Practices

1. **Always use `@Injectable()`** on classes with constructor dependencies
2. **Bind services in service providers**, not in controllers or routes
3. **Use singletons** for stateless services (repositories, services)
4. **Use transient bindings** for request-scoped or stateful services
5. **Organize providers** by domain (AppServiceProvider, DatabaseServiceProvider, etc.)
6. **Keep constructors simple** - only assign dependencies, no business logic
7. **Use interfaces** for better testability (when needed)

---

## Migration from String-Based DI

If you're migrating from string-based injection:

```typescript
// OLD - String-based (still works)
app.bind('UserService', () => new UserService());
const service = app.make<UserService>('UserService');

// NEW - Class-based (recommended)
app.bind(UserService, () => new UserService());
const service = app.make(UserService);

@Injectable()
class UserController {
  constructor(private userService: UserService) {} // Auto-resolved
}
```

Both approaches work, but class-based DI is more type-safe and enables automatic constructor injection.

---

## Testing with DI

Mock services for testing:

```typescript
// Create a mock service
class MockUserService {
  async getUsers() {
    return [{ id: 1, name: 'Test User' }];
  }
}

// In your test setup
const app = new Application(__dirname);
app.singleton(UserService, () => new MockUserService());

// Controllers will receive the mock
const controller = app.make(UserController);
```

---

## FAQ

**Q: Do I need `@Injectable()` on every class?**

A: Only on classes that need constructor dependency injection. Services that are only created via `new` don't need it.

**Q: Can I mix constructor and property injection?**

A: Yes, but constructor injection is recommended for required dependencies.

**Q: Why not use decorators like `@Inject()`?**

A: TypeScript's `emitDecoratorMetadata` provides type information automatically, making explicit `@Inject()` decorators unnecessary in most cases.

**Q: Can I inject primitives (strings, numbers)?**

A: No, only classes and registered abstract keys. Use configuration objects for primitives:

```typescript
app.instance('config', { apiKey: 'abc123' });

@Injectable()
class MyService {
  constructor(private container: Container) {}

  getApiKey() {
    return this.container.make<any>('config').apiKey;
  }
}
```

**Q: Does this work with JavaScript (non-TypeScript)?**

A: No, this requires TypeScript's decorator metadata emission. For JavaScript, use factory functions or explicit binding.

---

## Summary

✅ **Required Steps:**
1. Add `import 'reflect-metadata'` as first line in entry file
2. Enable `experimentalDecorators` and `emitDecoratorMetadata` in tsconfig.json
3. Bind services to container via service providers
4. Add `@Injectable()` decorator to classes needing DI
5. Type-hint constructor parameters

🚫 **Common Mistakes:**
- Forgetting `@Injectable()` decorator
- Not binding services to the container
- Not importing `reflect-metadata` first
- Wrong TypeScript compiler settings
- Using property injection without initialization

---

For more information, see the main [README](./README.md) or the [Container source code](./src/Container/Container.ts).
