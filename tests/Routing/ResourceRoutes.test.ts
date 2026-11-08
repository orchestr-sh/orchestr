/**
 * Resource route registration - Route.resource() / Route.apiResource()
 */

import { IncomingMessage, ServerResponse } from 'http';
import { Socket } from 'net';
import { describe, it, expect, beforeEach } from 'vitest';
import { Application } from '@/Foundation/Application';
import { Controller } from '@/Routing/Controller';
import { Request } from '@/Routing/Request';
import { buildResourceRoutes } from '@/Routing/ResourceRegistrar';
import { Response } from '@/Routing/Response';
import { Router } from '@/Routing/Router';

class UserController extends Controller {
  index() {
    return 'index';
  }
  create() {
    return 'create';
  }
  store() {
    return 'store';
  }
  show() {
    return 'show';
  }
  edit() {
    return 'edit';
  }
  update() {
    return 'update';
  }
  destroy() {
    return 'destroy';
  }
}

describe('buildResourceRoutes()', () => {
  it('produces the seven conventional routes from one table', () => {
    expect(buildResourceRoutes('users').map((d) => [d.action, d.methods, d.uri, d.name])).toEqual([
      ['index', ['GET'], '/users', 'users.index'],
      ['create', ['GET'], '/users/create', 'users.create'],
      ['store', ['POST'], '/users', 'users.store'],
      ['show', ['GET'], '/users/:user', 'users.show'],
      ['edit', ['GET'], '/users/:user/edit', 'users.edit'],
      ['update', ['PUT', 'PATCH'], '/users/:user', 'users.update'],
      ['destroy', ['DELETE'], '/users/:user', 'users.destroy'],
    ]);
  });

  it('apiResource drops the HTML-only create/edit actions', () => {
    expect(buildResourceRoutes('users', {}, true).map((d) => d.action)).toEqual([
      'index',
      'store',
      'show',
      'update',
      'destroy',
    ]);
  });

  it('filters with only and except (array or single)', () => {
    expect(buildResourceRoutes('users', { only: ['index', 'show'] }).map((d) => d.action)).toEqual(['index', 'show']);
    expect(buildResourceRoutes('users', { except: ['edit'] }).map((d) => d.action)).toEqual([
      'index',
      'create',
      'store',
      'show',
      'update',
      'destroy',
    ]);
    expect(buildResourceRoutes('users', { only: 'index' }).map((d) => d.action)).toEqual(['index']);
  });

  it('rejects unknown action names', () => {
    expect(() => buildResourceRoutes('users', { only: ['nope' as never] })).toThrow(/Invalid resource action \[nope\]/);
    expect(() => buildResourceRoutes('users', { except: ['blurge' as never] })).toThrow(/Invalid resource action/);
  });

  it('names option replaces action segments or the whole prefix', () => {
    const custom = buildResourceRoutes('users', { names: { index: 'members' } });
    expect(custom.find((d) => d.action === 'index')!.name).toBe('users.members');
    expect(custom.find((d) => d.action === 'show')!.name).toBe('users.show');

    expect(buildResourceRoutes('users', { names: 'admins' }).find((d) => d.action === 'index')!.name).toBe(
      'admins.index'
    );

    // A dotted custom name is taken as the full name
    expect(
      buildResourceRoutes('users', { names: { show: 'user.profile' } }).find((d) => d.action === 'show')!.name
    ).toBe('user.profile');
  });

  it('parameters option renames route parameters', () => {
    const defs = buildResourceRoutes('users', { parameters: { user: 'uuid' } });
    expect(defs.find((d) => d.action === 'show')!.uri).toBe('/users/:uuid');
  });

  it('builds nested resources from dot notation', () => {
    const defs = buildResourceRoutes('users.posts');
    expect(defs.find((d) => d.action === 'index')!.uri).toBe('/users/:user/posts');
    expect(defs.find((d) => d.action === 'index')!.name).toBe('users.posts.index');
    expect(defs.find((d) => d.action === 'store')!.uri).toBe('/users/:user/posts');
    expect(defs.find((d) => d.action === 'create')!.uri).toBe('/users/:user/posts/create');
    expect(defs.find((d) => d.action === 'show')!.uri).toBe('/users/:user/posts/:post');
    expect(defs.find((d) => d.action === 'edit')!.uri).toBe('/users/:user/posts/:post/edit');
  });

  it('shallow moves item routes under the child only', () => {
    const defs = buildResourceRoutes('users.posts', { shallow: true });
    expect(defs.find((d) => d.action === 'index')!.uri).toBe('/users/:user/posts');
    expect(defs.find((d) => d.action === 'show')!.uri).toBe('/posts/:post');
    expect(defs.find((d) => d.action === 'show')!.name).toBe('users.posts.show');
    expect(defs.find((d) => d.action === 'update')!.uri).toBe('/posts/:post');
    expect(defs.find((d) => d.action === 'destroy')!.uri).toBe('/posts/:post');
  });

  it('shallow is a no-op on flat resources', () => {
    expect(buildResourceRoutes('users', { shallow: true })).toEqual(buildResourceRoutes('users'));
  });

  it('rejects malformed resource names', () => {
    expect(() => buildResourceRoutes('users.')).toThrow(/Invalid resource name/);
  });
});

describe('Router.resource()/apiResource()', () => {
  let app: Application;
  let router: Router;

  beforeEach(() => {
    app = new Application('/test');
    router = new Router(app);
  });

  const actionName = (method: string, path: string, host?: string): string | undefined => {
    const route = router.findRoute(method, path, host);
    if (!route) {
      return undefined;
    }

    const action = route.action as [unknown, string];
    return Array.isArray(action) ? action[1] : undefined;
  };

  it('registers all seven routes with conventional names', () => {
    const routes = router.resource('users', UserController);

    expect(routes).toHaveLength(7);
    expect(routes.map((route) => route.name)).toEqual([
      'users.index',
      'users.create',
      'users.store',
      'users.show',
      'users.edit',
      'users.update',
      'users.destroy',
    ]);

    // create/edit are registered before show so their literals win
    expect(actionName('GET', '/users')).toBe('index');
    expect(actionName('GET', '/users/create')).toBe('create');
    expect(actionName('GET', '/users/1')).toBe('show');
    expect(actionName('GET', '/users/1/edit')).toBe('edit');
    expect(actionName('POST', '/users')).toBe('store');
    expect(actionName('PUT', '/users/1')).toBe('update');
    expect(actionName('PATCH', '/users/1')).toBe('update');
    expect(actionName('DELETE', '/users/1')).toBe('destroy');
  });

  it('answers 405 with Allow on a resource path without a matching verb', async () => {
    router.resource('users', UserController);

    const res = await dispatch('DELETE', '/users');
    expect(res.status).toBe(405);
    expect(res.headers['Allow']).toContain('GET');
  });

  it('dispatches resource actions to the controller', async () => {
    router.resource('users', UserController);

    expect((await dispatch('GET', '/users')).body).toBe('index');
    expect((await dispatch('GET', '/users/1')).body).toBe('show');
    expect((await dispatch('DELETE', '/users/2')).body).toBe('destroy');
  });

  it('apiResource registers the five JSON-friendly routes', () => {
    const routes = router.apiResource('users', UserController);

    expect(routes.map((route) => route.name)).toEqual([
      'users.index',
      'users.store',
      'users.show',
      'users.update',
      'users.destroy',
    ]);
    expect(router.getByName('users.create')).toBeUndefined();
    expect(router.getByName('users.edit')).toBeUndefined();
    expect(router.findRoute('GET', '/users/1/edit')).toBeNull();
  });

  it('honours only and except', () => {
    router.resource('users', UserController, { only: ['index', 'show'] });
    expect(router.getRoutes()).toHaveLength(2);

    router.resource('tags', UserController, { except: ['destroy'] });
    expect(router.findRoute('DELETE', '/tags/1')).toBeNull();
    expect(router.findRoute('GET', '/tags/1')).not.toBeNull();
  });

  it('honours the names option', () => {
    router.resource('photos', UserController, { names: { index: 'thumbnails' } });
    expect(router.url('photos.thumbnails')).toBe('/photos');

    router.resource('comments', UserController, { names: 'replies' });
    expect(router.url('replies.index')).toBe('/comments');
  });

  it('honours the parameters option', () => {
    router.resource('users', UserController, { parameters: { user: 'uuid' } });

    expect(router.findRoute('GET', '/users/abc')!.getParameters()).toEqual({ uuid: 'abc' });
    expect(router.url('users.show', { uuid: 'abc' })).toBe('/users/abc');
  });

  it('honours shallow on nested resources', () => {
    router.resource('users.posts', UserController, { shallow: true });

    expect(router.url('users.posts.index', { user: 1 })).toBe('/users/1/posts');
    expect(router.url('users.posts.show', { post: 2 })).toBe('/posts/2');
    expect(router.findRoute('GET', '/posts/2')!.getParameters()).toEqual({ post: '2' });
  });

  it('generates conventional names usable for URL building', () => {
    router.resource('users', UserController);

    expect(router.url('users.show', { user: 1 })).toBe('/users/1');
    expect(router.url('users.update', { user: 1, redirect: '/profile' })).toBe('/users/1?redirect=%2Fprofile');
    expect(router.url('users.destroy', { user: '42' })).toBe('/users/42');
  });

  it('supports Controller@action string controllers', () => {
    router.resource('reports', 'ReportController');

    expect(router.findRoute('GET', '/reports')!.action).toBe('ReportController@index');
    expect(router.findRoute('GET', '/reports/1')!.action).toBe('ReportController@show');
    expect(router.findRoute('DELETE', '/reports/1')!.action).toBe('ReportController@destroy');
  });

  it('composes with group prefix and name attributes', () => {
    router.group({ prefix: 'api', name: 'v1' }, () => {
      router.resource('users', UserController);
    });

    expect(router.getRoutes().every((route) => route.uri.startsWith('/api/'))).toBe(true);
    expect(router.getRoutes().map((route) => route.name)).toEqual([
      'v1.users.index',
      'v1.users.create',
      'v1.users.store',
      'v1.users.show',
      'v1.users.edit',
      'v1.users.update',
      'v1.users.destroy',
    ]);
    expect(router.url('v1.users.show', { user: 4 })).toBe('/api/users/4');
  });

  // -------------------------------------------------------------------------

  async function dispatch(
    method: string,
    url: string
  ): Promise<{ status: number; body: string; headers: Record<string, string> }> {
    const req = new IncomingMessage(new Socket());
    req.method = method;
    req.url = url;
    req.headers = {};

    const request = new Request(req);
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

    return { status: raw.statusCode, body: chunks.join(''), headers };
  }
});
