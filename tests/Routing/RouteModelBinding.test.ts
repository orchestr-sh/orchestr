/**
 * Route model binding and controller dependency injection
 *
 * Exercises the ticket end-to-end through `Router.dispatch()`: scalar route
 * parameters, implicit/explicit/custom-key model bindings, scoped bindings,
 * `Controller@method` string actions resolved from the container, FormRequest
 * validation, and services injected into controller actions in any order.
 *
 * Model bindings hit the database, so - like the soft-delete suite - these
 * integration tests only run when the better-sqlite3 driver is installed.
 */

import { IncomingMessage, ServerResponse } from 'http';
import { Socket } from 'net';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ValidationRules } from '@/Foundation/Http/Validator';
import { DrizzleAdapter } from '@/Database/Adapters/DrizzleAdapter';
import { DatabaseManager } from '@/Database/DatabaseManager';
import { Ensemble } from '@/Database/Ensemble/Ensemble';
import { Application } from '@/Foundation/Application';
import { FormRequest } from '@/Foundation/Http/FormRequest';
import { Action } from '@/Routing/Action';
import { Controller } from '@/Routing/Controller';
import { ModelNotFoundException } from '@/Routing/ModelNotFoundException';
import { Request } from '@/Routing/Request';
import { Response } from '@/Routing/Response';
import { Route as RouteClass } from '@/Routing/Route';
import { Router } from '@/Routing/Router';
import { Injectable } from '@/Support/Injectable';
import { ValidateRequest } from '@/Support/ValidateRequest';

async function hasBetterSqlite(): Promise<boolean> {
  try {
    await import('better-sqlite3');
    return true;
  } catch {
    return false;
  }
}

const SCHEMA = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    email TEXT,
    created_at TEXT,
    updated_at TEXT
  );
  CREATE TABLE posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    title TEXT,
    created_at TEXT,
    updated_at TEXT
  );
  CREATE TABLE pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT,
    created_at TEXT,
    updated_at TEXT
  );
`;

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

class User extends Ensemble {
  static fillable: string[] = ['name', 'email'];

  getTable(): string {
    return 'users';
  }

  posts() {
    return this.hasMany(Post, 'user_id');
  }
}

class Post extends Ensemble {
  static fillable: string[] = ['user_id', 'title'];

  getTable(): string {
    return 'posts';
  }
}

class Page extends Ensemble {
  static fillable: string[] = ['slug'];

  getTable(): string {
    return 'pages';
  }

  /**
   * Custom route key: implicit binding looks pages up by slug, not id
   */
  getRouteKeyName(): string {
    return 'slug';
  }
}

// ---------------------------------------------------------------------------
// Services & requests
// ---------------------------------------------------------------------------

class GreetingService {
  greet(name: string): string {
    return `Hello, ${name}!`;
  }
}

class StoreUserRequest extends FormRequest {
  protected rules(): ValidationRules {
    return { name: 'required|string' };
  }
}

class DeniedUserRequest extends FormRequest {
  protected authorize(): boolean {
    return false;
  }

  protected rules(): ValidationRules {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Test controllers
// ---------------------------------------------------------------------------

@Injectable()
class BindingTestController extends Controller {
  /**
   * Implicit binding plus Request injection in "any order" positions
   */
  @Action()
  show(request: Request, user: User) {
    const route = request.route() as unknown as RouteClass;

    return {
      bound: user instanceof User,
      name: user.getAttribute('name'),
      requestRouteMatches: request.route('user') === user,
      routeParamMatches: request.routeParam('user') === user,
      parametersMatch: route.parameters.user === user,
      routeUri: route.uri,
    };
  }

  /**
   * Scalar route parameter injected by name
   */
  @Action()
  scalar(request: Request, id: string) {
    return { id, fromRequest: request.route('id') };
  }

  /**
   * Model, service and request parameters in a scrambled order
   */
  @Action()
  mixed(greeting: GreetingService, user: User, request: Request) {
    return {
      greeting: greeting.greet(user.getAttribute('name')),
      userId: request.route('user'),
    };
  }

  /**
   * Response as the first parameter, written directly
   */
  @Action()
  responds(response: Response, user: User) {
    response.header('X-Bound-Key', String(user.getKey()));
    response.status(202).json({ sent: true, name: user.getAttribute('name') });
  }

  /**
   * Implicit binding against a model with a custom route key name
   */
  @Action()
  page(request: Request, page: Page) {
    return { slug: page.getAttribute('slug'), bound: page instanceof Page };
  }

  /**
   * Scoped bindings: the child must belong to the parent
   */
  @Action()
  scoped(user: User, post: Post) {
    return { user: user.getKey(), post: post.getAttribute('title') };
  }

  /**
   * Same route shape without scoping
   */
  @Action()
  unscoped(user: User, post: Post) {
    return { user: user.getKey(), post: post.getAttribute('title') };
  }

  /**
   * Used through the 'BindingTestController@byName' string action
   */
  @Action()
  byName(user: User) {
    return { name: user.getAttribute('name') };
  }

  /**
   * FormRequest validation, preserving the historical 422 behaviour
   */
  @ValidateRequest()
  async store(request: StoreUserRequest, response: Response) {
    response.status(201).json({ created: request.validated() });
  }

  /**
   * Failing authorization, preserving the historical 403 behaviour
   */
  @ValidateRequest()
  async deny(request: DeniedUserRequest, response: Response) {
    response.json({ unreachable: true });
  }
}

// No decorators at all: actions keep receiving (request, response)
class LegacyTestController extends Controller {
  ping(request: any, response: any) {
    response.json({ legacy: true, params: request.params });
  }
}

// ---------------------------------------------------------------------------

const WITH_SQLITE = await hasBetterSqlite();

describe.skipIf(!WITH_SQLITE)('Route model binding and controller DI', () => {
  let adapter: DrizzleAdapter;
  let app: Application;
  let router: Router;

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

    app = new Application('/test');
    router = new Router(app);

    const ada = await User.create({ name: 'Ada', email: 'ada@example.com' });
    const bob = await User.create({ name: 'Bob', email: 'bob@example.com' });
    await Post.create({ user_id: ada.getKey(), title: 'Analytical Engines' });
    await Post.create({ user_id: bob.getKey(), title: 'Bob Securely' });
    await Page.create({ slug: 'welcome' });
  });

  afterEach(async () => {
    await adapter.disconnect();
  });

  function createRawRequest(method: string, url: string): IncomingMessage {
    const req = new IncomingMessage(new Socket());
    req.method = method;
    req.url = url;
    req.headers = {};
    return req;
  }

  interface DispatchResult {
    status: number;
    body: string;
    json: () => any;
    headers: Record<string, string>;
  }

  async function dispatch(method: string, url: string, body: Record<string, any> = {}): Promise<DispatchResult> {
    const request = new Request(createRawRequest(method, url));
    request.body = body;

    const raw = new ServerResponse(request.raw);
    const chunks: string[] = [];
    const headers: Record<string, string> = {};
    raw.end = ((data?: any) => {
      if (data !== undefined && data !== null) {
        chunks.push(String(data));
      }
    }) as any;
    raw.setHeader = ((name: string, value: any) => {
      headers[name] = String(value);
    }) as any;

    const response = new Response(raw);
    await router.dispatch(request, response);

    return {
      status: raw.statusCode,
      body: chunks.join(''),
      json: () => JSON.parse(chunks.join('')),
      headers,
    };
  }

  describe('implicit model binding', () => {
    it('passes a User instance to a model-typed controller parameter', async () => {
      router.get('/users/:user', [BindingTestController, 'show']);

      const res = await dispatch('GET', '/users/1');

      expect(res.status).toBe(200);
      expect(res.json()).toEqual({
        bound: true,
        name: 'Ada',
        requestRouteMatches: true,
        routeParamMatches: true,
        parametersMatch: true,
        routeUri: '/users/:user',
      });
    });

    it('resolves integer keys typed as strings from the URL', async () => {
      router.get('/users/:user', [BindingTestController, 'show']);

      const res = await dispatch('GET', '/users/2');

      expect(res.json().name).toBe('Bob');
    });

    it('honours getRouteKeyName() for custom keys', async () => {
      router.get('/pages/:page', [BindingTestController, 'page']);

      const res = await dispatch('GET', '/pages/welcome');

      expect(res.status).toBe(200);
      expect(res.json()).toEqual({ slug: 'welcome', bound: true });
    });

    it('returns a 404 when the model does not exist', async () => {
      router.get('/users/:user', [BindingTestController, 'show']);

      const res = await dispatch('GET', '/users/999');

      expect(res.status).toBe(404);
      expect(res.body).toBe('Not Found');
    });

    it('throws ModelNotFoundException carrying the model and id', async () => {
      const resolver = router.getRouteResolver();
      const route = new RouteClass('GET', '/users/:user', [BindingTestController, 'show']);
      route.bind('/users/999');

      await expect(resolver.resolveModel(User, '999', null, 'user')).rejects.toBeInstanceOf(ModelNotFoundException);

      try {
        await resolver.resolveModel(User, '999', null, 'user');
      } catch (error) {
        const exception = error as ModelNotFoundException;
        expect(exception.getModel()).toBe(User);
        expect(exception.getIds()).toEqual([999]);
        expect(exception.message).toContain('No query results for model [User]');
      }
    });

    it('skips binding when an optional segment is absent', async () => {
      router.get('/optional/:user?', (_request: Request, response: Response) => {
        response.json({ present: _request.route('user') !== undefined });
      });

      const res = await dispatch('GET', '/optional/');

      expect(res.status).toBe(200);
      expect(res.json()).toEqual({ present: false });
    });
  });

  describe('explicit bindings', () => {
    it('Route.bind() resolves parameters through the callback', async () => {
      router.bind('token', (value) => ({ upper: String(value).toUpperCase() }));
      router.get('/tokens/:token', (request: Request, response: Response) => {
        response.json({ bound: request.route('token') });
      });

      const res = await dispatch('GET', '/tokens/abc');

      expect(res.json()).toEqual({ bound: { upper: 'ABC' } });
    });

    it('Route.model() binds a parameter to a model class by name', async () => {
      router.model('user', User);
      router.get('/bound-users/:user', (request: Request, response: Response) => {
        const user = request.route('user');
        response.json({ name: user.getAttribute('name'), isModel: user instanceof User });
      });

      const res = await dispatch('GET', '/bound-users/2');

      expect(res.json()).toEqual({ name: 'Bob', isModel: true });
    });

    it('Route.model() yields 404 for a missing record', async () => {
      router.model('user', User);
      router.get('/bound-users/:user', (_request: Request, response: Response) => response.json({ ok: true }));

      const res = await dispatch('GET', '/bound-users/404');

      expect(res.status).toBe(404);
    });

    it('Route.model() rejects non-model classes', () => {
      expect(() => router.model('thing', GreetingService as never)).toThrow(/Ensemble model class/);
    });
  });

  describe('scoped bindings', () => {
    it('constrains the child binding by its parent relation', async () => {
      router.get('/users/:user/posts/:post', [BindingTestController, 'scoped']).scopeBindings();

      const res = await dispatch('GET', '/users/1/posts/1');

      expect(res.status).toBe(200);
      expect(res.json()).toEqual({ user: 1, post: 'Analytical Engines' });
    });

    it('404s a child that exists but belongs to another parent', async () => {
      router.get('/users/:user/posts/:post', [BindingTestController, 'scoped']).scopeBindings();

      const res = await dispatch('GET', '/users/1/posts/2');

      expect(res.status).toBe(404);
    });

    it('without scopeBindings the sibling row resolves', async () => {
      router.get('/users/:user/posts/:post', [BindingTestController, 'unscoped']);

      const res = await dispatch('GET', '/users/1/posts/2');

      expect(res.status).toBe(200);
      expect(res.json()).toEqual({ user: 1, post: 'Bob Securely' });
    });

    it('Router.scopeBindings() marks the enclosing group', async () => {
      router.group({ prefix: 'api' }, () => {
        router.scopeBindings();
        router.get('/users/:user/posts/:post', [BindingTestController, 'scoped']);
      });

      expect(await dispatch('GET', '/api/users/1/posts/1')).toMatchObject({ status: 200 });
      expect(await dispatch('GET', '/api/users/1/posts/2')).toMatchObject({ status: 404 });
    });
  });

  describe('controller dependency injection', () => {
    it('injects scalar route parameters by name', async () => {
      router.get('/scalars/:id', [BindingTestController, 'scalar']);

      const res = await dispatch('GET', '/scalars/42');

      expect(res.json()).toEqual({ id: '42', fromRequest: '42' });
    });

    it('resolves parameters in any order (service, model, request)', async () => {
      router.get('/mixed/:user', [BindingTestController, 'mixed']);

      const res = await dispatch('GET', '/mixed/1');

      expect(res.status).toBe(200);

      const json = res.json();
      expect(json.greeting).toBe('Hello, Ada!');
      expect(json.userId.name).toBe('Ada');
    });

    it('injects the Response and lets the action write it first', async () => {
      router.get('/responds/:user', [BindingTestController, 'responds']);

      const res = await dispatch('GET', '/responds/1');

      expect(res.status).toBe(202);
      expect(res.headers['X-Bound-Key']).toBe('1');
      expect(res.json()).toEqual({ sent: true, name: 'Ada' });
    });

    it('keeps the historical (request, response) behaviour for undecorated actions', async () => {
      router.get('/legacy/:id', [LegacyTestController, 'ping']);

      const res = await dispatch('GET', '/legacy/7');

      expect(res.json()).toEqual({ legacy: true, params: { id: '7' } });
    });

    it('supports Controller@method strings resolved from the container', async () => {
      app.bind('BindingTestController', BindingTestController);
      router.get('/strings/:user', 'BindingTestController@byName');

      const res = await dispatch('GET', '/strings/1');

      expect(res.json()).toEqual({ name: 'Ada' });
    });

    it('errors clearly for unresolvable string actions', async () => {
      router.get('/strings/:user', 'MissingController@byName');

      const res = await dispatch('GET', '/strings/1');

      expect(res.status).toBe(500);
      expect(res.body).toContain('Controller [MissingController] is not resolvable');
    });

    it('errors for malformed string actions', async () => {
      router.get('/bad', 'NoMethodHere');

      const res = await dispatch('GET', '/bad');

      expect(res.status).toBe(500);
      expect(res.body).toContain('Malformed controller action');
    });
  });

  describe('FormRequest behaviour (preserved)', () => {
    it('validates and passes the FormRequest to the action', async () => {
      router.post('/users', [BindingTestController, 'store']);

      const res = await dispatch('POST', '/users', { name: 'Claude' });

      expect(res.status).toBe(201);
      expect(res.json()).toEqual({ created: { name: 'Claude' } });
    });

    it('answers 422 with the error bag when validation fails', async () => {
      router.post('/users', [BindingTestController, 'store']);

      const res = await dispatch('POST', '/users', {});

      expect(res.status).toBe(422);
      expect(res.json().message).toBe('The given data was invalid.');
      expect(res.json().errors.name).toBeDefined();
    });

    it('answers 403 when the FormRequest denies authorization', async () => {
      router.post('/denied', [BindingTestController, 'deny']);

      const res = await dispatch('POST', '/denied', {});

      expect(res.status).toBe(403);
      expect(res.json()).toEqual({ message: 'This action is unauthorized.' });
    });
  });
});
