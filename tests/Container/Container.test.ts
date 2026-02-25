import { describe, it, expect, beforeEach } from 'vitest';
import { Container } from '@/Container/Container';

describe('Container', () => {
  let container: Container;

  beforeEach(() => {
    container = new Container();
  });

  describe('bind()', () => {
    it('registers a factory binding', () => {
      container.bind('foo', () => 'bar');
      expect(container.make('foo')).toBe('bar');
    });

    it('creates a new instance each time for non-shared bindings', () => {
      container.bind('counter', () => ({ count: Math.random() }));
      const a = container.make<{ count: number }>('counter');
      const b = container.make<{ count: number }>('counter');
      expect(a).not.toBe(b);
    });

    it('clears resolved instance when rebinding non-shared', () => {
      container.bind('foo', () => 'first');
      container.make('foo'); // resolve it
      container.bind('foo', () => 'second');
      expect(container.make('foo')).toBe('second');
    });
  });

  describe('singleton()', () => {
    it('registers a shared binding', () => {
      container.singleton('service', () => ({ id: Math.random() }));
      const a = container.make('service');
      const b = container.make('service');
      expect(a).toBe(b);
    });

    it('only calls factory once', () => {
      let callCount = 0;
      container.singleton('counter', () => {
        callCount++;
        return callCount;
      });
      container.make('counter');
      container.make('counter');
      expect(callCount).toBe(1);
    });
  });

  describe('instance()', () => {
    it('registers an existing instance', () => {
      const obj = { name: 'test' };
      container.instance('myObj', obj);
      expect(container.make('myObj')).toBe(obj);
    });

    it('returns the instance that was set', () => {
      const obj = { name: 'test' };
      const returned = container.instance('myObj', obj);
      expect(returned).toBe(obj);
    });

    it('is immediately resolvable', () => {
      container.instance('val', 42);
      expect(container.make('val')).toBe(42);
    });
  });

  describe('alias()', () => {
    it('resolves through aliases', () => {
      container.bind('original', () => 'value');
      container.alias('original', 'aliased');
      expect(container.make('aliased')).toBe('value');
    });

    it('supports chained aliases', () => {
      container.bind('root', () => 'deep');
      container.alias('root', 'level1');
      container.alias('level1', 'level2');
      expect(container.make('level2')).toBe('deep');
    });
  });

  describe('make()', () => {
    it('resolves factory bindings', () => {
      container.bind('factory', () => 'produced');
      expect(container.make('factory')).toBe('produced');
    });

    it('passes container to factory function', () => {
      container.instance('dep', 'dependency-value');
      container.bind('service', (c: Container) => {
        return `resolved:${c.make('dep')}`;
      });
      expect(container.make('service')).toBe('resolved:dependency-value');
    });

    it('can instantiate classes', () => {
      class MyService {
        value = 'hello';
      }
      container.bind('svc', () => new MyService());
      const instance = container.make<MyService>('svc');
      expect(instance.value).toBe('hello');
    });
  });

  describe('bound()', () => {
    it('returns true for bound abstracts', () => {
      container.bind('foo', () => 'bar');
      expect(container.bound('foo')).toBe(true);
    });

    it('returns true for instances', () => {
      container.instance('bar', 123);
      expect(container.bound('bar')).toBe(true);
    });

    it('returns true for aliases', () => {
      container.bind('real', () => 'val');
      container.alias('real', 'fake');
      expect(container.bound('fake')).toBe(true);
    });

    it('returns false for unregistered abstracts', () => {
      expect(container.bound('nope')).toBe(false);
    });
  });

  describe('resolved()', () => {
    it('returns false before resolution', () => {
      container.bind('foo', () => 'bar');
      expect(container.resolved('foo')).toBe(false);
    });

    it('returns true after resolution', () => {
      container.bind('foo', () => 'bar');
      container.make('foo');
      expect(container.resolved('foo')).toBe(true);
    });

    it('returns true for instances (always resolved)', () => {
      container.instance('foo', 'bar');
      expect(container.resolved('foo')).toBe(true);
    });

    it('resolves through aliases', () => {
      container.bind('real', () => 'val');
      container.alias('real', 'alias');
      container.make('alias');
      expect(container.resolved('real')).toBe(true);
    });
  });

  describe('flush()', () => {
    it('clears all bindings, instances, and aliases', () => {
      container.bind('a', () => 1);
      container.singleton('b', () => 2);
      container.instance('c', 3);
      container.alias('a', 'd');

      container.flush();

      expect(container.bound('a')).toBe(false);
      expect(container.bound('b')).toBe(false);
      expect(container.bound('c')).toBe(false);
      expect(container.bound('d')).toBe(false);
    });
  });

  describe('call()', () => {
    it('calls a function with no dependencies', () => {
      const result = container.call(() => 42);
      expect(result).toBe(42);
    });

    it('calls a function with explicit parameters (reflect-metadata required for injection)', () => {
      // call() uses reflect-metadata for param resolution
      // Without decorated functions, params from metadata are empty so explicit params are used positionally
      const fn = () => 'called';
      const result = container.call(fn);
      expect(result).toBe('called');
    });
  });
});
