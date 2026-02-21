"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const Application_1 = require("../../src/Foundation/Application");
const ServiceProvider_1 = require("../../src/Foundation/ServiceProvider");
class TestProvider extends ServiceProvider_1.ServiceProvider {
    registered = false;
    booted = false;
    register() {
        this.registered = true;
        this.app.instance('test-service', { name: 'test' });
    }
    boot() {
        this.booted = true;
    }
}
class AsyncBootProvider extends ServiceProvider_1.ServiceProvider {
    booted = false;
    register() { }
    async boot() {
        await new Promise((resolve) => setTimeout(resolve, 10));
        this.booted = true;
    }
}
(0, vitest_1.describe)('Application', () => {
    let app;
    (0, vitest_1.beforeEach)(() => {
        app = new Application_1.Application('/test/base');
    });
    (0, vitest_1.describe)('constructor', () => {
        (0, vitest_1.it)('extends Container', () => {
            (0, vitest_1.expect)(app.make('app')).toBe(app);
        });
        (0, vitest_1.it)('registers base bindings', () => {
            (0, vitest_1.expect)(app.make('app')).toBe(app);
            (0, vitest_1.expect)(app.make(Application_1.Application)).toBe(app);
        });
        (0, vitest_1.it)('uses provided base path', () => {
            (0, vitest_1.expect)(app.getBasePath()).toBe('/test/base');
        });
        (0, vitest_1.it)('defaults base path to cwd', () => {
            const defaultApp = new Application_1.Application();
            (0, vitest_1.expect)(defaultApp.getBasePath()).toBe(process.cwd());
        });
    });
    (0, vitest_1.describe)('path helpers', () => {
        (0, vitest_1.it)('returns app path', () => {
            (0, vitest_1.expect)(app.path()).toBe('/test/base/app');
            (0, vitest_1.expect)(app.path('Models')).toBe('/test/base/app/Models');
        });
        (0, vitest_1.it)('returns config path', () => {
            (0, vitest_1.expect)(app.configPath()).toBe('/test/base/config');
            (0, vitest_1.expect)(app.configPath('app.ts')).toBe('/test/base/config/app.ts');
        });
        (0, vitest_1.it)('returns database path', () => {
            (0, vitest_1.expect)(app.databasePath()).toBe('/test/base/database');
            (0, vitest_1.expect)(app.databasePath('migrations')).toBe('/test/base/database/migrations');
        });
        (0, vitest_1.it)('returns storage path', () => {
            (0, vitest_1.expect)(app.storagePath()).toBe('/test/base/storage');
        });
        (0, vitest_1.it)('returns public path', () => {
            (0, vitest_1.expect)(app.publicPath()).toBe('/test/base/public');
        });
    });
    (0, vitest_1.describe)('setBasePath()', () => {
        (0, vitest_1.it)('changes the base path', () => {
            app.setBasePath('/new/path');
            (0, vitest_1.expect)(app.getBasePath()).toBe('/new/path');
        });
        (0, vitest_1.it)('returns the application for chaining', () => {
            const result = app.setBasePath('/new');
            (0, vitest_1.expect)(result).toBe(app);
        });
    });
    (0, vitest_1.describe)('register()', () => {
        (0, vitest_1.it)('registers a service provider instance', () => {
            const provider = new TestProvider(app);
            app.register(provider);
            (0, vitest_1.expect)(provider.registered).toBe(true);
        });
        (0, vitest_1.it)('registers a service provider class', () => {
            app.register(TestProvider);
            (0, vitest_1.expect)(app.make('test-service')).toEqual({ name: 'test' });
        });
        (0, vitest_1.it)('does not register the same provider twice', () => {
            const provider = new TestProvider(app);
            app.register(provider);
            app.register(provider);
            (0, vitest_1.expect)(app.getProviders().length).toBe(1);
        });
        (0, vitest_1.it)('boots provider if application is already booted', async () => {
            await app.boot();
            const provider = new TestProvider(app);
            app.register(provider);
            (0, vitest_1.expect)(provider.booted).toBe(true);
        });
        (0, vitest_1.it)('returns the provider instance', () => {
            const result = app.register(TestProvider);
            (0, vitest_1.expect)(result).toBeInstanceOf(TestProvider);
        });
    });
    (0, vitest_1.describe)('registerProviders()', () => {
        (0, vitest_1.it)('registers multiple providers', () => {
            app.registerProviders([TestProvider]);
            (0, vitest_1.expect)(app.getProviders().length).toBe(1);
        });
    });
    (0, vitest_1.describe)('boot()', () => {
        (0, vitest_1.it)('boots all registered providers', async () => {
            const provider = new TestProvider(app);
            app.register(provider);
            await app.boot();
            (0, vitest_1.expect)(provider.booted).toBe(true);
        });
        (0, vitest_1.it)('handles async boot methods', async () => {
            const provider = new AsyncBootProvider(app);
            app.register(provider);
            await app.boot();
            (0, vitest_1.expect)(provider.booted).toBe(true);
        });
        (0, vitest_1.it)('only boots once', async () => {
            let bootCount = 0;
            class CountingProvider extends ServiceProvider_1.ServiceProvider {
                register() { }
                boot() {
                    bootCount++;
                }
            }
            app.register(new CountingProvider(app));
            await app.boot();
            await app.boot();
            (0, vitest_1.expect)(bootCount).toBe(1);
        });
        (0, vitest_1.it)('sets booted flag', async () => {
            (0, vitest_1.expect)(app.isBooted()).toBe(false);
            await app.boot();
            (0, vitest_1.expect)(app.isBooted()).toBe(true);
        });
    });
    (0, vitest_1.describe)('terminating', () => {
        (0, vitest_1.it)('registers and calls terminating callbacks', () => {
            let called = false;
            app.terminating(() => {
                called = true;
            });
            app.terminate();
            (0, vitest_1.expect)(called).toBe(true);
        });
        (0, vitest_1.it)('calls multiple terminating callbacks', () => {
            const calls = [];
            app.terminating(() => calls.push(1));
            app.terminating(() => calls.push(2));
            app.terminate();
            (0, vitest_1.expect)(calls).toEqual([1, 2]);
        });
    });
    (0, vitest_1.describe)('environment helpers', () => {
        (0, vitest_1.it)('returns version', () => {
            (0, vitest_1.expect)(app.version()).toBe('0.1.0');
        });
        (0, vitest_1.it)('returns environment file', () => {
            (0, vitest_1.expect)(app.environmentFile()).toBe('.env');
        });
        (0, vitest_1.it)('returns environment', () => {
            (0, vitest_1.expect)(typeof app.environment()).toBe('string');
        });
        (0, vitest_1.it)('returns runningInConsole', () => {
            (0, vitest_1.expect)(typeof app.runningInConsole()).toBe('boolean');
        });
    });
    (0, vitest_1.describe)('withEvents()', () => {
        (0, vitest_1.it)('sets event discovery paths', () => {
            app.withEvents({ discover: ['/path/a', '/path/b'] });
            (0, vitest_1.expect)(app.getEventDiscoveryPaths()).toEqual(['/path/a', '/path/b']);
        });
        (0, vitest_1.it)('defaults to app/Listeners', () => {
            (0, vitest_1.expect)(app.getEventDiscoveryPaths()).toEqual(['/test/base/app/Listeners']);
        });
        (0, vitest_1.it)('returns the application for chaining', () => {
            const result = app.withEvents({});
            (0, vitest_1.expect)(result).toBe(app);
        });
    });
});
//# sourceMappingURL=Application.test.js.map