"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const Container_1 = require("../../src/Container/Container");
(0, vitest_1.describe)('Container', () => {
    let container;
    (0, vitest_1.beforeEach)(() => {
        container = new Container_1.Container();
    });
    (0, vitest_1.describe)('bind()', () => {
        (0, vitest_1.it)('registers a factory binding', () => {
            container.bind('foo', () => 'bar');
            (0, vitest_1.expect)(container.make('foo')).toBe('bar');
        });
        (0, vitest_1.it)('creates a new instance each time for non-shared bindings', () => {
            container.bind('counter', () => ({ count: Math.random() }));
            const a = container.make('counter');
            const b = container.make('counter');
            (0, vitest_1.expect)(a).not.toBe(b);
        });
        (0, vitest_1.it)('clears resolved instance when rebinding non-shared', () => {
            container.bind('foo', () => 'first');
            container.make('foo'); // resolve it
            container.bind('foo', () => 'second');
            (0, vitest_1.expect)(container.make('foo')).toBe('second');
        });
    });
    (0, vitest_1.describe)('singleton()', () => {
        (0, vitest_1.it)('registers a shared binding', () => {
            container.singleton('service', () => ({ id: Math.random() }));
            const a = container.make('service');
            const b = container.make('service');
            (0, vitest_1.expect)(a).toBe(b);
        });
        (0, vitest_1.it)('only calls factory once', () => {
            let callCount = 0;
            container.singleton('counter', () => {
                callCount++;
                return callCount;
            });
            container.make('counter');
            container.make('counter');
            (0, vitest_1.expect)(callCount).toBe(1);
        });
    });
    (0, vitest_1.describe)('instance()', () => {
        (0, vitest_1.it)('registers an existing instance', () => {
            const obj = { name: 'test' };
            container.instance('myObj', obj);
            (0, vitest_1.expect)(container.make('myObj')).toBe(obj);
        });
        (0, vitest_1.it)('returns the instance that was set', () => {
            const obj = { name: 'test' };
            const returned = container.instance('myObj', obj);
            (0, vitest_1.expect)(returned).toBe(obj);
        });
        (0, vitest_1.it)('is immediately resolvable', () => {
            container.instance('val', 42);
            (0, vitest_1.expect)(container.make('val')).toBe(42);
        });
    });
    (0, vitest_1.describe)('alias()', () => {
        (0, vitest_1.it)('resolves through aliases', () => {
            container.bind('original', () => 'value');
            container.alias('original', 'aliased');
            (0, vitest_1.expect)(container.make('aliased')).toBe('value');
        });
        (0, vitest_1.it)('supports chained aliases', () => {
            container.bind('root', () => 'deep');
            container.alias('root', 'level1');
            container.alias('level1', 'level2');
            (0, vitest_1.expect)(container.make('level2')).toBe('deep');
        });
    });
    (0, vitest_1.describe)('make()', () => {
        (0, vitest_1.it)('resolves factory bindings', () => {
            container.bind('factory', () => 'produced');
            (0, vitest_1.expect)(container.make('factory')).toBe('produced');
        });
        (0, vitest_1.it)('passes container to factory function', () => {
            container.instance('dep', 'dependency-value');
            container.bind('service', (c) => {
                return `resolved:${c.make('dep')}`;
            });
            (0, vitest_1.expect)(container.make('service')).toBe('resolved:dependency-value');
        });
        (0, vitest_1.it)('can instantiate classes', () => {
            class MyService {
                value = 'hello';
            }
            container.bind('svc', () => new MyService());
            const instance = container.make('svc');
            (0, vitest_1.expect)(instance.value).toBe('hello');
        });
    });
    (0, vitest_1.describe)('bound()', () => {
        (0, vitest_1.it)('returns true for bound abstracts', () => {
            container.bind('foo', () => 'bar');
            (0, vitest_1.expect)(container.bound('foo')).toBe(true);
        });
        (0, vitest_1.it)('returns true for instances', () => {
            container.instance('bar', 123);
            (0, vitest_1.expect)(container.bound('bar')).toBe(true);
        });
        (0, vitest_1.it)('returns true for aliases', () => {
            container.bind('real', () => 'val');
            container.alias('real', 'fake');
            (0, vitest_1.expect)(container.bound('fake')).toBe(true);
        });
        (0, vitest_1.it)('returns false for unregistered abstracts', () => {
            (0, vitest_1.expect)(container.bound('nope')).toBe(false);
        });
    });
    (0, vitest_1.describe)('resolved()', () => {
        (0, vitest_1.it)('returns false before resolution', () => {
            container.bind('foo', () => 'bar');
            (0, vitest_1.expect)(container.resolved('foo')).toBe(false);
        });
        (0, vitest_1.it)('returns true after resolution', () => {
            container.bind('foo', () => 'bar');
            container.make('foo');
            (0, vitest_1.expect)(container.resolved('foo')).toBe(true);
        });
        (0, vitest_1.it)('returns true for instances (always resolved)', () => {
            container.instance('foo', 'bar');
            (0, vitest_1.expect)(container.resolved('foo')).toBe(true);
        });
        (0, vitest_1.it)('resolves through aliases', () => {
            container.bind('real', () => 'val');
            container.alias('real', 'alias');
            container.make('alias');
            (0, vitest_1.expect)(container.resolved('real')).toBe(true);
        });
    });
    (0, vitest_1.describe)('flush()', () => {
        (0, vitest_1.it)('clears all bindings, instances, and aliases', () => {
            container.bind('a', () => 1);
            container.singleton('b', () => 2);
            container.instance('c', 3);
            container.alias('a', 'd');
            container.flush();
            (0, vitest_1.expect)(container.bound('a')).toBe(false);
            (0, vitest_1.expect)(container.bound('b')).toBe(false);
            (0, vitest_1.expect)(container.bound('c')).toBe(false);
            (0, vitest_1.expect)(container.bound('d')).toBe(false);
        });
    });
    (0, vitest_1.describe)('call()', () => {
        (0, vitest_1.it)('calls a function with no dependencies', () => {
            const result = container.call(() => 42);
            (0, vitest_1.expect)(result).toBe(42);
        });
        (0, vitest_1.it)('calls a function with explicit parameters (reflect-metadata required for injection)', () => {
            // call() uses reflect-metadata for param resolution
            // Without decorated functions, params from metadata are empty so explicit params are used positionally
            const fn = () => 'called';
            const result = container.call(fn);
            (0, vitest_1.expect)(result).toBe('called');
        });
    });
});
//# sourceMappingURL=Container.test.js.map