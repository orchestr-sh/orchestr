"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const Facade_1 = require("../../src/Support/Facade");
const Application_1 = require("../../src/Foundation/Application");
class TestService {
    greet(name) {
        return `Hello, ${name}!`;
    }
    getValue() {
        return 42;
    }
}
(0, vitest_1.describe)('Facade', () => {
    let app;
    (0, vitest_1.beforeEach)(() => {
        app = new Application_1.Application('/test');
        app.instance('test-service', new TestService());
        Facade_1.Facade.setFacadeApplication(app);
    });
    (0, vitest_1.afterEach)(() => {
        Facade_1.Facade.clearResolvedInstances();
    });
    (0, vitest_1.describe)('setFacadeApplication()', () => {
        (0, vitest_1.it)('sets the application instance', () => {
            (0, vitest_1.expect)(Facade_1.Facade.getFacadeApplication()).toBe(app);
        });
    });
    (0, vitest_1.describe)('clearResolvedInstance()', () => {
        (0, vitest_1.it)('clears a specific resolved instance', () => {
            // Create a facade, resolve it, clear it
            const TestFacade = (0, Facade_1.createFacade)('test-service');
            TestFacade.greet('World'); // resolve
            Facade_1.Facade.clearResolvedInstance('test-service');
            // Should re-resolve
            (0, vitest_1.expect)(TestFacade.greet('World')).toBe('Hello, World!');
        });
    });
    (0, vitest_1.describe)('clearResolvedInstances()', () => {
        (0, vitest_1.it)('clears all resolved instances', () => {
            Facade_1.Facade.clearResolvedInstances();
            // No error should occur
        });
    });
    (0, vitest_1.describe)('getFacadeAccessor() error', () => {
        (0, vitest_1.it)('throws if not overridden', () => {
            class BadFacade extends Facade_1.Facade {
            }
            (0, vitest_1.expect)(() => BadFacade.getFacadeAccessor()).toThrow('Facade does not implement getFacadeAccessor method');
        });
    });
});
(0, vitest_1.describe)('createFacade()', () => {
    let app;
    (0, vitest_1.beforeEach)(() => {
        app = new Application_1.Application('/test');
        app.instance('test-service', new TestService());
        Facade_1.Facade.setFacadeApplication(app);
    });
    (0, vitest_1.afterEach)(() => {
        Facade_1.Facade.clearResolvedInstances();
    });
    (0, vitest_1.it)('creates a proxy facade that calls methods on the root', () => {
        const TestFacade = (0, Facade_1.createFacade)('test-service');
        (0, vitest_1.expect)(TestFacade.greet('World')).toBe('Hello, World!');
    });
    (0, vitest_1.it)('proxies property access', () => {
        const TestFacade = (0, Facade_1.createFacade)('test-service');
        (0, vitest_1.expect)(TestFacade.getValue()).toBe(42);
    });
    (0, vitest_1.it)('throws when no app is set', () => {
        Facade_1.Facade.setFacadeApplication(undefined);
        const TestFacade = (0, Facade_1.createFacade)('test-service');
        (0, vitest_1.expect)(() => TestFacade.greet('World')).toThrow('facade root has not been set');
    });
});
//# sourceMappingURL=Facade.test.js.map