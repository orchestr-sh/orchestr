/**
 * RouteResolver - reflection and binding mechanics that need no database
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Ensemble } from '@/Database/Ensemble/Ensemble';
import { Application } from '@/Foundation/Application';
import { FormRequest } from '@/Foundation/Http/FormRequest';
import { Action } from '@/Routing/Action';
import { Controller } from '@/Routing/Controller';
import { ModelNotFoundException } from '@/Routing/ModelNotFoundException';
import { Request } from '@/Routing/Request';
import { Response } from '@/Routing/Response';
import { Route } from '@/Routing/Route';
import { RouteResolver } from '@/Routing/RouteResolver';
import { Injectable } from '@/Support/Injectable';

describe('RouteResolver', () => {
  let app: Application;
  let resolver: RouteResolver;

  beforeEach(() => {
    app = new Application('/test');
    resolver = new RouteResolver(app);
  });

  describe('parseParameterNames()', () => {
    it('reads plain parameter names', () => {
      const fn = function show(request: any, user: any) {};
      expect(RouteResolver.parseParameterNames(fn)).toEqual(['request', 'user']);
    });

    it('reads async method signatures', () => {
      const fn = async function store(request: any) {};
      expect(RouteResolver.parseParameterNames(fn)).toEqual(['request']);
    });

    it('reads arrow functions', () => {
      const fn = (id: any, slug: any) => {};
      expect(RouteResolver.parseParameterNames(fn)).toEqual(['id', 'slug']);
    });

    it('reads zero-arity functions', () => {
      const fn = () => {};
      expect(RouteResolver.parseParameterNames(fn)).toEqual([]);
    });

    it('handles default values without leaking them into names', () => {
      const fn = function index(page: any = 1, perPage: any = 25) {};
      expect(RouteResolver.parseParameterNames(fn)).toEqual(['page', 'perPage']);
      expect(RouteResolver.parseHasDefaults(fn)).toEqual([true, true]);
    });

    it('handles commas nested inside defaults', () => {
      const fn = function grid(items: any = [1, 2, 3], label: any = 'a,b') {};
      expect(RouteResolver.parseParameterNames(fn)).toEqual(['items', 'label']);
    });

    it('reports destructured parameters as unnamed', () => {
      const fn = function mutate({ id }: any, name: any) {};
      expect(RouteResolver.parseParameterNames(fn)).toEqual([undefined, 'name']);
    });

    it('handles rest parameters', () => {
      const fn = function collect(first: any, ...rest: any[]) {};
      expect(RouteResolver.parseParameterNames(fn)).toEqual(['first', 'rest']);
    });

    it('handles prototype methods through toString', () => {
      class Sample {
        run(alpha: any, beta: any) {}
      }
      expect(RouteResolver.parseParameterNames(Sample.prototype.run)).toEqual(['alpha', 'beta']);
    });
  });

  describe('type predicates', () => {
    it('recognises Ensemble subclasses as models', () => {
      class Widget extends Ensemble {
        getTable(): string {
          return 'widgets';
        }
      }

      expect(RouteResolver.isModelClass(Widget)).toBe(true);
      expect(RouteResolver.isModelClass(Ensemble)).toBe(true);
      expect(RouteResolver.isModelClass(class Plain {})).toBe(false);
      expect(RouteResolver.isModelClass(String)).toBe(false);
      expect(RouteResolver.isModelClass(undefined)).toBe(false);
    });

    it('recognises FormRequest subclasses', () => {
      class StoreThing extends FormRequest {
        protected rules() {
          return {};
        }
      }

      expect(RouteResolver.isFormRequestClass(StoreThing)).toBe(true);
      expect(RouteResolver.isFormRequestClass(FormRequest)).toBe(true);
      expect(RouteResolver.isFormRequestClass(Request)).toBe(false);
    });

    it('recognises Request/Response but refuses them as services', () => {
      expect(RouteResolver.isRequestClass(Request)).toBe(true);
      expect(RouteResolver.isResponseClass(Response)).toBe(true);
      expect(RouteResolver.isResolvableService(Request)).toBe(false);
      expect(RouteResolver.isResolvableService(Response)).toBe(false);
      expect(RouteResolver.isResolvableService(Object)).toBe(false);
      expect(RouteResolver.isResolvableService(String)).toBe(false);
      expect(
        RouteResolver.isResolvableService(
          class Widget extends Ensemble {
            getTable() {
              return 'w';
            }
          }
        )
      ).toBe(false);
      expect(RouteResolver.isResolvableService(class Service {})).toBe(true);
    });
  });

  describe('reflectMethod()', () => {
    it('reads names and design:paramtypes from decorated actions', () => {
      class Dummy {}

      @Injectable()
      class Sample extends Controller {
        @Action()
        show(request: Request, dummy: Dummy) {}
      }

      const reflection = resolver.reflectMethod(Sample.prototype, 'show');

      expect(reflection.names).toEqual(['request', 'dummy']);
      expect(reflection.types[0]).toBe(Request);
      expect(reflection.types[1]).toBe(Dummy);
    });

    it('reflects an empty signature for missing methods', () => {
      const reflection = resolver.reflectMethod(class {}, 'ghost');
      expect(reflection.names).toEqual([]);
      expect(reflection.types).toEqual([]);
    });
  });

  describe('substituteBindings()', () => {
    it('runs explicit binders over the raw parameters', async () => {
      resolver.bind('token', (value) => `token:${value}`);
      const route = new Route('GET', '/sessions/:token', () => {});
      route.bind('/sessions/abc');

      await resolver.substituteBindings(route);

      expect(route.parameters).toEqual({ token: 'token:abc' });
    });

    it('leaves parameters without bindings untouched', async () => {
      const route = new Route('GET', '/users/:id', () => {});
      route.bind('/users/15');

      await resolver.substituteBindings(route);

      expect(route.parameters).toEqual({ id: '15' });
    });

    it('awaits async binders', async () => {
      resolver.bind('slug', async (value) => String(value).toUpperCase());
      const route = new Route('GET', '/pages/:slug', () => {});
      route.bind('/pages/hello');

      await resolver.substituteBindings(route);

      expect(route.parameters.slug).toBe('HELLO');
    });

    it('skips empty optional segments', async () => {
      resolver.bind('user', () => 'resolved');
      const route = new Route('GET', '/profile/:user?', () => {});
      route.bind('/profile/');

      await resolver.substituteBindings(route);

      expect(route.parameters.user).toBeUndefined();
    });
  });

  describe('model()', () => {
    it('rejects classes that are not Ensemble models', () => {
      expect(() => resolver.model('thing', Object as never)).toThrow(/Ensemble model class/);
    });
  });

  describe('resolveArguments()', () => {
    it('falls back to (request, response) for unreflected actions', async () => {
      const request = {} as Request;
      const response = {} as Response;

      const args = await resolver.resolveArguments(
        { names: ['req', 'res'], hasDefault: [false, false], types: [] },
        {},
        request,
        response
      );

      expect(args).toEqual([request, response]);
    });

    it('passes route parameters by name to typed actions', async () => {
      class Widget extends Ensemble {
        getTable() {
          return 'widgets';
        }
      }

      @Injectable()
      class Sample extends Controller {
        @Action()
        show(id: string, widget: Widget, request: Request) {}
      }

      const reflection = resolver.reflectMethod(Sample.prototype, 'show');
      const widget = {} as Widget;
      const request = {} as Request;
      const response = {} as Response;

      const args = await resolver.resolveArguments(reflection, { id: '7', widget }, request, response);

      expect(args[0]).toBe('7');
      expect(args[1]).toBe(widget);
      expect(args[2]).toBe(request);
    });

    it('builds container-resolvable services', async () => {
      class Ledger {
        total(): number {
          return 42;
        }
      }

      @Injectable()
      class Sample extends Controller {
        @Action()
        show(ledger: Ledger) {}
      }

      const reflection = resolver.reflectMethod(Sample.prototype, 'show');
      const args = await resolver.resolveArguments(reflection, {}, {} as Request, {} as Response);

      expect(args[0]).toBeInstanceOf(Ledger);
      expect(args[0].total()).toBe(42);
    });
  });
});

describe('Ensemble route keys', () => {
  it('defaults the route key name to the primary key', () => {
    class Thing extends Ensemble {
      getTable() {
        return 'things';
      }
    }

    const thing = new Thing();
    expect(thing.getRouteKeyName()).toBe('id');
    expect(thing.getKeyName()).toBe('id');
  });

  it('honours a custom route key name and resolves its value', () => {
    class SlugThing extends Ensemble {
      getTable() {
        return 'slugs';
      }

      getRouteKeyName(): string {
        return 'slug';
      }
    }

    const thing = new SlugThing();
    thing.setAttribute('slug', 'orchestr');

    expect(thing.getRouteKeyName()).toBe('slug');
    expect(thing.getRouteKey()).toBe('orchestr');
  });
});

describe('ModelNotFoundException', () => {
  it('carries the model and the missing ids', () => {
    class Post extends Ensemble {
      getTable() {
        return 'posts';
      }
    }

    const exception = ModelNotFoundException.forModel(Post, ['xyz']);

    expect(exception).toBeInstanceOf(Error);
    expect(exception).toBeInstanceOf(ModelNotFoundException);
    expect(exception.name).toBe('ModelNotFoundException');
    expect(exception.getModel()).toBe(Post);
    expect(exception.getIds()).toEqual(['xyz']);
    expect(exception.message).toBe('No query results for model [Post] xyz');
  });

  it('supports fluent setModel', () => {
    class Post extends Ensemble {
      getTable() {
        return 'posts';
      }
    }

    const exception = new ModelNotFoundException('gone');
    expect(exception.setModel(Post, [1, 2])).toBe(exception);
    expect(exception.getIds()).toEqual([1, 2]);
  });
});
