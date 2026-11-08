import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Application } from '@/Foundation/Application';
import { Config } from '@/Foundation/Config/Config';
import { Collection } from '@/Support/Collection';
import {
  setGlobalApp,
  getGlobalApp,
  config,
  base_path,
  routes_path,
  resource_path,
  str,
  arr,
  data_get,
  data_set,
  value,
  tap,
  optional,
  throw_if,
  throw_unless,
  class_basename,
  snake_case,
  camel_case,
  studly_case,
  kebab_case,
  title_case,
  now,
  today,
  collect,
} from '@/Support/helpers';

describe('helpers', () => {
  describe('setGlobalApp() / getGlobalApp()', () => {
    afterEach(() => {
      setGlobalApp(null as any);
    });

    it('sets and gets the global app', () => {
      const app = new Application('/test');
      setGlobalApp(app);
      expect(getGlobalApp()).toBe(app);
    });
  });

  describe('config()', () => {
    let app: Application;

    beforeEach(() => {
      app = new Application('/test');
      const configInstance = new Config({
        app: { name: 'TestApp', debug: true },
      });
      app.instance('config', configInstance);
      setGlobalApp(app);
    });

    afterEach(() => {
      setGlobalApp(null as any);
    });

    it('gets a config value', () => {
      expect(config('app.name')).toBe('TestApp');
    });

    it('gets config with default', () => {
      expect(config('app.missing', 'fallback')).toBe('fallback');
    });

    it('returns config instance when no key', () => {
      const result = config();
      expect(result).toBeInstanceOf(Config);
    });

    it('throws when app not initialized', () => {
      setGlobalApp(null as any);
      expect(() => config('anything')).toThrow('Application not initialized');
    });
  });

  describe('base_path()', () => {
    it('returns cwd', () => {
      expect(base_path()).toBe(process.cwd());
    });

    it('appends path', () => {
      expect(base_path('app')).toBe(`${process.cwd()}/app`);
    });
  });

  describe('routes_path()', () => {
    it('returns routes directory', () => {
      expect(routes_path()).toBe(`${process.cwd()}/routes`);
    });

    it('appends path', () => {
      expect(routes_path('web.ts')).toBe(`${process.cwd()}/routes/web.ts`);
    });
  });

  describe('resource_path()', () => {
    it('returns resources directory', () => {
      expect(resource_path()).toBe(`${process.cwd()}/resources`);
    });

    it('appends path', () => {
      expect(resource_path('views')).toBe(`${process.cwd()}/resources/views`);
    });
  });
});

describe('Support helpers', () => {
  describe('str() / arr()', () => {
    it('expose the utility classes', () => {
      expect(str().slug('Hello, World!')).toBe('hello-world');
      expect(str().camel('foo_bar')).toBe('fooBar');
      expect(arr().get({ a: { b: [{ c: 1 }] } }, 'a.b.0.c')).toBe(1);
    });
  });

  describe('collect()', () => {
    it('creates a Collection', () => {
      const items = collect([1, 2]);

      expect(items).toBeInstanceOf(Collection);
      expect(items.all()).toEqual([1, 2]);
    });
  });

  describe('data_get()', () => {
    it('reads dot paths with numeric segments', () => {
      expect(data_get({ products: [{ price: 100 }] }, 'products.0.price')).toBe(100);
      expect(data_get({ a: { b: 1 } }, 'a.b')).toBe(1);
    });

    it('returns defaults for missing paths', () => {
      expect(data_get({ a: 1 }, 'b.c', 'fallback')).toBe('fallback');
      expect(data_get(null, 'a', 'fallback')).toBe('fallback');
    });

    it('supports wildcards', () => {
      expect(data_get({ users: [{ name: 'a' }, { name: 'b' }] }, 'users.*.name')).toEqual(['a', 'b']);
    });

    it('returns the whole target when no key is given', () => {
      expect(data_get({ a: 1 })).toEqual({ a: 1 });
    });
  });

  describe('data_set()', () => {
    it('creates missing intermediate objects', () => {
      const target: any = {};

      data_set(target, 'a.b', 2);
      expect(target).toEqual({ a: { b: 2 } });
    });

    it('creates arrays for numeric segments', () => {
      expect(data_set({} as any, 'a.0.b', 5)).toEqual({ a: [{ b: 5 }] });
    });

    it('overwrites existing values', () => {
      expect(data_set({ a: { b: 1 } } as any, 'a.b', 2)).toEqual({ a: { b: 2 } });
    });

    it('accepts a list of keys', () => {
      expect(data_set({} as any, ['x.y', 'x.z'], 'v')).toEqual({ x: { y: 'v', z: 'v' } });
    });

    it('expands wildcards across children', () => {
      const data = { users: [{ name: 'a' }, { name: 'b' }] };

      data_set(data, 'users.*.active', true);
      expect(data).toEqual({
        users: [
          { name: 'a', active: true },
          { name: 'b', active: true },
        ],
      });
    });

    it('returns nullish targets untouched', () => {
      expect(data_set(null as any, 'a', 1)).toBeNull();
    });
  });

  describe('value() / tap()', () => {
    it('value() resolves closures', () => {
      expect(value(() => 42)).toBe(42);
      expect(value(10)).toBe(10);
    });

    it('tap() yields the value to the callback and returns it', () => {
      const seen: number[] = [];

      expect(
        tap(5, (inner) => {
          seen.push(inner);
        })
      ).toBe(5);
      expect(seen).toEqual([5]);
      expect(tap(7)).toBe(7);
    });
  });

  describe('optional()', () => {
    it('invokes the callback when provided', () => {
      expect(optional({ a: 1 }, (value) => (value as any).a + 1)).toBe(2);
    });

    it('reads properties safely', () => {
      expect(optional({ name: 'Taylor' }).name).toBe('Taylor');
      expect(optional(null).name).toBeUndefined();
    });

    it('exposes value, get, call and collect', () => {
      expect(optional({ a: 1 }).value).toEqual({ a: 1 });
      expect(optional(null).value).toBeNull();
      expect(optional({ a: { b: 2 } }).get('a.b')).toBe(2);
      expect(optional(null).get('a', 'fallback')).toBe('fallback');

      const user = {
        name(n: string) {
          return `hi ${n}`;
        },
      };
      expect(optional(user).call('name', 'bob')).toBe('hi bob');
      expect(optional(null).call('name', 'bob')).toBeUndefined();
      expect(() => optional(null).mustCall('name')).toThrow('Attempted to call method on a null value.');

      expect(optional([1, 2]).collect().all()).toEqual([1, 2]);
      expect(optional(null).collect().all()).toEqual([]);
    });
  });

  describe('throw_if() / throw_unless()', () => {
    it('throws when conditions are not met', () => {
      expect(() => throw_if(true)).toThrow('One or many conditions have not been met');
      expect(() => throw_if(1, 'boom')).toThrow('boom');
      expect(() => throw_if(true, TypeError, 'typed')).toThrow(TypeError);
      expect(() => throw_unless(false, 'nope')).toThrow('nope');
      expect(() => throw_if(() => true)).toThrow(Error);
    });

    it('does not throw when conditions are met', () => {
      expect(() => throw_if(false)).not.toThrow();
      expect(() => throw_if(null)).not.toThrow();
      expect(() => throw_unless(true)).not.toThrow();
      expect(() => throw_unless(() => 1)).not.toThrow();
    });

    it('re-throws given error instances', () => {
      const error = new RangeError('range');

      expect(() => throw_if(true, error)).toThrow(error);
    });
  });

  describe('class_basename()', () => {
    it('reads class names from instances, constructors and strings', () => {
      class Example {}

      expect(class_basename(new Example())).toBe('Example');
      expect(class_basename(Example)).toBe('Example');
      expect(class_basename('App\\Models\\User')).toBe('User');
      expect(class_basename(collect([]))).toBe('Collection');
    });
  });

  describe('case helpers', () => {
    it('delegate to Str', () => {
      expect(snake_case('fooBar')).toBe('foo_bar');
      expect(camel_case('foo_bar')).toBe('fooBar');
      expect(studly_case('foo_bar')).toBe('FooBar');
      expect(kebab_case('fooBar')).toBe('foo-bar');
      expect(title_case('hello world')).toBe('Hello World');
    });
  });

  describe('now() / today()', () => {
    it('returns dates', () => {
      const before = Date.now();
      const moment = now();

      expect(moment).toBeInstanceOf(Date);
      expect(moment.getTime()).toBeGreaterThanOrEqual(before);
      expect(moment.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('today() is local midnight', () => {
      const day = today();

      expect(day).toBeInstanceOf(Date);
      expect([day.getHours(), day.getMinutes(), day.getSeconds(), day.getMilliseconds()]).toEqual([0, 0, 0, 0]);
    });
  });
});

describe('package entry point', () => {
  it('exports the new Support utilities and helpers', async () => {
    const entry = await import('@/index');

    for (const name of [
      'Str',
      'Arr',
      'Number',
      'str',
      'arr',
      'collect',
      'data_get',
      'data_set',
      'value',
      'tap',
      'optional',
      'throw_if',
      'throw_unless',
      'class_basename',
      'snake_case',
      'camel_case',
      'studly_case',
      'kebab_case',
      'title_case',
      'now',
      'today',
    ]) {
      expect(entry).toHaveProperty(name);
    }

    expect(entry.Str.slug('Hello, World!')).toBe('hello-world');
    expect(entry.Arr.get({ a: { b: [{ c: 1 }] } }, 'a.b.0.c')).toBe(1);
    expect(entry.Number.ordinal(21)).toBe('21st');
    expect(entry.collect([1, 2])).toBeInstanceOf(entry.Collection);
  });
});
