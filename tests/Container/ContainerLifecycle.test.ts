import 'reflect-metadata';
import { IncomingMessage, ServerResponse } from 'http';
import { Socket } from 'net';
import { describe, it, expect, beforeEach } from 'vitest';
import { Container } from '@/Container/Container';
import { Application } from '@/Foundation/Application';
import { Kernel } from '@/Foundation/Http/Kernel';
import { Router } from '@/Routing/Router';

class Service {
  id: number;

  constructor() {
    Service.counter++;
    this.id = Service.counter;
  }

  static counter = 0;
}

describe('Container lifecycle parity', () => {
  let container: Container;

  beforeEach(() => {
    Service.counter = 0;
    container = new Container();
  });

  describe('extend()', () => {
    it('decorates every resolution of the abstract', () => {
      container.bind('greeter', () => ({ greeted: false }));
      container.extend('greeter', (instance) => ({ ...instance, greeted: true }));

      expect(container.make('greeter')).toEqual({ greeted: true });
      expect(container.make('greeter')).toEqual({ greeted: true });
    });

    it('applies multiple extensions in registration order', () => {
      container.bind('chain', () => ({ steps: [] as string[] }));
      container.extend('chain', (instance) => ({ ...instance, steps: [...instance.steps, 'first'] }));
      container.extend('chain', (instance) => ({ ...instance, steps: [...instance.steps, 'second'] }));

      expect(container.make<{ steps: string[] }>('chain').steps).toEqual(['first', 'second']);
    });

    it('decorates an existing instance immediately', () => {
      container.instance('counted', { value: 1 });
      container.extend('counted', (instance: { value: number }) => ({ ...instance, value: instance.value + 10 }));

      expect(container.make('counted')).toEqual({ value: 11 });
    });

    it('receives the container as the second argument', () => {
      container.bind('self', () => ({}));
      let seen: Container | undefined;
      container.extend('self', (instance, c) => {
        seen = c;

        return instance;
      });

      container.make('self');

      expect(seen).toBe(container);
    });

    it('decorates shared bindings before they are cached', () => {
      container.singleton(Service);
      container.extend(Service, (instance: Service) => {
        (instance as any).decorated = true;

        return instance;
      });

      const first = container.make<Service>(Service);

      expect((first as any).decorated).toBe(true);
      expect(container.make(Service)).toBe(first);
    });
  });

  describe('rebinding()', () => {
    it('fires callbacks when an already-resolved binding is registered again', () => {
      container.bind('foo', () => ({ id: 1 }));
      container.make('foo');

      const seen: any[] = [];
      container.rebinding('foo', (_c, instance) => seen.push(instance));

      container.bind('foo', () => ({ id: 2 }));

      expect(seen).toHaveLength(1);
      expect(seen[0]).toEqual({ id: 2 });
      expect(container.make('foo')).toEqual({ id: 2 });
    });

    it('fires when an existing abstract receives a new instance()', () => {
      container.bind('foo', () => ({ id: 1 }));
      container.make('foo');

      const seen: any[] = [];
      container.rebinding('foo', (_c, instance) => seen.push(instance));

      const replacement = { id: 9 };
      container.instance('foo', replacement);

      expect(seen).toEqual([replacement]);
      expect(container.make('foo')).toBe(replacement);
    });

    it('does not fire on the first registration', () => {
      const callback = (_c: Container, _i: any): void => {
        throw new Error('should not fire');
      };

      container.rebinding('fresh', callback);
      container.bind('fresh', () => 1);

      expect(container.make('fresh')).toBe(1);
    });
  });

  describe('resolving() and afterResolving()', () => {
    it('fires both hooks for every fresh build with the instance and container', () => {
      const events: string[] = [];
      container.bind('bar', () => ({ name: 'bar' }));

      container.resolving('bar', (instance, c) => {
        events.push(`resolving:${instance.name}:${c === container ? 'container' : 'other'}`);
      });
      container.afterResolving('bar', (instance) => events.push(`after:${instance.name}`));

      container.make('bar');
      container.make('bar');

      expect(events).toEqual(['resolving:bar:container', 'after:bar', 'resolving:bar:container', 'after:bar']);
    });

    it('fires once for shared bindings because later resolutions are cached', () => {
      const events: string[] = [];
      container.singleton('cache', () => ({}));
      container.afterResolving('cache', () => events.push('fired'));

      container.make('cache');
      container.make('cache');

      expect(events).toEqual(['fired']);
    });

    it('matches subclasses registered by class', () => {
      class Base {}
      class Child extends Base {}

      const seen: unknown[] = [];
      container.resolving(Base, (instance) => seen.push(instance));

      container.make(Child);

      expect(seen).toHaveLength(1);
      expect(seen[0]).toBeInstanceOf(Child);
    });

    it('supports the global closure form', () => {
      const events: unknown[] = [];
      container.resolving((instance) => events.push(instance));

      container.bind('thing', () => 'value');
      container.make('thing');

      expect(events).toEqual(['value']);
    });

    it('supports the explicit * wildcard key', () => {
      const events: unknown[] = [];
      container.afterResolving('*', (instance) => events.push(instance));

      container.bind('one', () => 1);
      container.bind('two', () => 2);
      container.make('one');
      container.make('two');

      expect(events).toEqual([1, 2]);
    });

    it('exposes the concretion currently being built', () => {
      class Inner {}
      class Consumer {
        constructor(public inner: any) {}
      }
      Reflect.defineMetadata('design:paramtypes', [Inner], Consumer);

      const seen: unknown[] = [];
      container.resolving(Inner, (_instance, c) => seen.push(c.currentlyResolving()));

      container.make(Consumer);

      expect(seen).toEqual([Consumer]);
    });
  });

  describe('forgetInstance() / forgetInstances()', () => {
    it('drops a single cached instance', () => {
      container.singleton(Service);

      const first = container.make(Service);
      container.forgetInstance(Service);
      const second = container.make(Service);

      expect(second).not.toBe(first);
    });

    it('clears every cached instance but keeps the bindings', () => {
      container.singleton(Service);
      const first = container.make(Service);

      container.forgetInstances();

      expect(container.bound(Service)).toBe(true);
      expect(container.make(Service)).not.toBe(first);
    });

    it('makes a bare instance registration forgettable', () => {
      const obj = { id: 1 };
      container.instance('obj', obj);

      container.forgetInstance('obj');

      // Only the instance cache remains after forget; there is no binding
      // to fall back to, exactly like Laravel.
      expect(() => container.make('obj')).toThrow('Target [obj] is not instantiable.');
    });
  });

  describe('makeWith() and build()', () => {
    it('substitutes named constructor parameters', () => {
      class Widget {
        constructor(
          public label: any,
          public count: any
        ) {}
      }
      Reflect.defineMetadata('design:paramtypes', [Object, Object], Widget);

      const widget = container.makeWith<Widget>(Widget, { label: 'hello', count: 3 });

      expect(widget.label).toBe('hello');
      expect(widget.count).toBe(3);
    });

    it('substitutes positional parameters like make()', () => {
      class Legacy {
        constructor(public first: any) {}
      }

      const instance = container.makeWith<Legacy>(Legacy, ['injected']);

      expect(instance.first).toBe('injected');
    });

    it('builds a concrete directly, with and without overrides', () => {
      const built = container.build(() => 'built');
      expect(built).toBe('built');

      class Manual {
        constructor(public value: any) {}
      }

      expect(container.build(Manual, ['passed']).value).toBe('passed');
    });
  });

  describe('factory() and wrap()', () => {
    it('factory returns a closure resolving on each invocation', () => {
      container.bind('counter', () => ({ n: Math.random() }));
      const makeCounter = container.factory<{ n: number }>('counter');

      expect(makeCounter()).not.toBe(makeCounter());
    });

    it('factory keeps singletons shared', () => {
      container.singleton(Service);
      const makeService = container.factory(Service);

      expect(makeService()).toBe(makeService());
    });

    it('wrap injects the closure dependencies when it runs', () => {
      const repository = { all: () => [] };

      const fn = (db: unknown) => db;

      const wrapped = container.wrap(fn, { db: repository });

      expect(wrapped()).toBe(repository);
    });
  });

  describe('error contracts stay put', () => {
    it('keeps the unresolvable-primitive message for reflected Object hints', () => {
      class NeedsPrimitive {
        constructor(public value: any) {}
      }
      Reflect.defineMetadata('design:paramtypes', [Object], NeedsPrimitive);

      expect(() => container.make(NeedsPrimitive)).toThrow(
        'Cannot resolve dependency at position 0 for NeedsPrimitive. ' +
          'Make sure TypeScript decorators are enabled and the class has proper type hints.'
      );
    });

    it('keeps the not-instantiable message for unbound string abstracts', () => {
      expect(() => container.make('ghost')).toThrow('Target [ghost] is not instantiable.');
    });
  });

  describe('scoped()', () => {
    it('shares within a scope and resets on forgetScopedInstances()', () => {
      let counter = 0;
      container.scoped('scope', () => ({ id: ++counter }));

      const first = container.make<{ id: number }>('scope');

      expect(container.make('scope')).toBe(first);

      container.forgetScopedInstances();

      const second = container.make<{ id: number }>('scope');

      expect(second).not.toBe(first);
      expect(second.id).toBe(2);
    });

    it('leaves ordinary singletons alone when the scope resets', () => {
      container.singleton('global', () => ({ id: 1 }));
      container.scoped('scope', () => ({ id: 1 }));

      const global = container.make('global');
      container.make('scope');
      container.forgetScopedInstances();

      expect(container.make('global')).toBe(global);
    });

    it('resets between HTTP requests handled by the kernel', async () => {
      const app = new Application('/test');
      const router = new Router(app);
      app.singleton('router', () => router);
      const kernel = new Kernel(app);

      let counter = 0;
      app.scoped('request-scope', () => ({ id: ++counter }));

      const observed: Array<{ inHandler: number; again: number }> = [];
      router.get('/scoped', () => {
        const first = app.make<{ id: number }>('request-scope');
        const second = app.make<{ id: number }>('request-scope');

        observed.push({ inHandler: first.id, again: second.id });

        return { id: first.id };
      });

      const dispatch = async (): Promise<void> => {
        const raw = new IncomingMessage(new Socket());
        raw.method = 'GET';
        raw.url = '/scoped';
        raw.headers = {};

        const res = new ServerResponse(raw);
        res.end = ((data?: any) => {
          if (data !== undefined && data !== null) {
            String(data);
          }
        }) as never;
        res.setHeader = (() => undefined) as never;

        await kernel.handle(raw, res);
      };

      await dispatch();
      await dispatch();

      // Same object within a request, a fresh one for the next request
      expect(observed).toHaveLength(2);
      expect(observed[0].inHandler).toBe(observed[0].again);
      expect(observed[1].inHandler).toBe(observed[1].again);
      expect(observed[1].inHandler).not.toBe(observed[0].inHandler);
    });

    it('resets between test cases through flush()', () => {
      let counter = 0;
      container.scoped('scope', () => ({ id: ++counter }));
      container.make('scope');

      container.flush();

      container.scoped('scope', () => ({ id: ++counter }));

      expect(container.make<{ id: number }>('scope').id).toBe(2);
    });
  });
});
