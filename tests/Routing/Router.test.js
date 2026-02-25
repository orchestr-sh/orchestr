"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const Router_1 = require("../../src/Routing/Router");
const Application_1 = require("../../src/Foundation/Application");
(0, vitest_1.describe)('Router', () => {
    let app;
    let router;
    (0, vitest_1.beforeEach)(() => {
        app = new Application_1.Application('/test');
        router = new Router_1.Router(app);
    });
    (0, vitest_1.describe)('HTTP method registration', () => {
        (0, vitest_1.it)('registers GET routes', () => {
            router.get('/users', () => { });
            const route = router.findRoute('GET', '/users');
            (0, vitest_1.expect)(route).not.toBeNull();
        });
        (0, vitest_1.it)('GET also matches HEAD', () => {
            router.get('/users', () => { });
            const route = router.findRoute('HEAD', '/users');
            (0, vitest_1.expect)(route).not.toBeNull();
        });
        (0, vitest_1.it)('registers POST routes', () => {
            router.post('/users', () => { });
            (0, vitest_1.expect)(router.findRoute('POST', '/users')).not.toBeNull();
        });
        (0, vitest_1.it)('registers PUT routes', () => {
            router.put('/users/:id', () => { });
            (0, vitest_1.expect)(router.findRoute('PUT', '/users/1')).not.toBeNull();
        });
        (0, vitest_1.it)('registers PATCH routes', () => {
            router.patch('/users/:id', () => { });
            (0, vitest_1.expect)(router.findRoute('PATCH', '/users/1')).not.toBeNull();
        });
        (0, vitest_1.it)('registers DELETE routes', () => {
            router.delete('/users/:id', () => { });
            (0, vitest_1.expect)(router.findRoute('DELETE', '/users/1')).not.toBeNull();
        });
        (0, vitest_1.it)('registers ANY routes', () => {
            router.any('/health', () => { });
            (0, vitest_1.expect)(router.findRoute('GET', '/health')).not.toBeNull();
            (0, vitest_1.expect)(router.findRoute('POST', '/health')).not.toBeNull();
            (0, vitest_1.expect)(router.findRoute('PUT', '/health')).not.toBeNull();
            (0, vitest_1.expect)(router.findRoute('DELETE', '/health')).not.toBeNull();
        });
        (0, vitest_1.it)('registers match routes with specific methods', () => {
            router.match(['GET', 'POST'], '/search', () => { });
            (0, vitest_1.expect)(router.findRoute('GET', '/search')).not.toBeNull();
            (0, vitest_1.expect)(router.findRoute('POST', '/search')).not.toBeNull();
            (0, vitest_1.expect)(router.findRoute('DELETE', '/search')).toBeNull();
        });
    });
    (0, vitest_1.describe)('findRoute()', () => {
        (0, vitest_1.it)('returns null for unmatched routes', () => {
            (0, vitest_1.expect)(router.findRoute('GET', '/nonexistent')).toBeNull();
        });
        (0, vitest_1.it)('binds parameters on match', () => {
            router.get('/users/:id', () => { });
            const route = router.findRoute('GET', '/users/42');
            (0, vitest_1.expect)(route.getParameters()).toEqual({ id: '42' });
        });
    });
    (0, vitest_1.describe)('group()', () => {
        (0, vitest_1.it)('applies prefix to routes in group', () => {
            router.group({ prefix: 'api' }, () => {
                router.get('/users', () => { });
            });
            (0, vitest_1.expect)(router.findRoute('GET', '/api/users')).not.toBeNull();
        });
        (0, vitest_1.it)('applies middleware to routes in group', () => {
            const middleware = vitest_1.vi.fn();
            router.group({ middleware }, () => {
                router.get('/protected', () => { });
            });
            const route = router.findRoute('GET', '/protected');
            (0, vitest_1.expect)(route.middleware).toContain(middleware);
        });
        (0, vitest_1.it)('applies array middleware to routes', () => {
            const mw1 = vitest_1.vi.fn();
            const mw2 = vitest_1.vi.fn();
            router.group({ middleware: [mw1, mw2] }, () => {
                router.get('/test', () => { });
            });
            const route = router.findRoute('GET', '/test');
            (0, vitest_1.expect)(route.middleware).toContain(mw1);
            (0, vitest_1.expect)(route.middleware).toContain(mw2);
        });
        (0, vitest_1.it)('supports nested groups', () => {
            router.group({ prefix: 'api' }, () => {
                router.group({ prefix: 'v1' }, () => {
                    router.get('/users', () => { });
                });
            });
            (0, vitest_1.expect)(router.findRoute('GET', '/api/v1/users')).not.toBeNull();
        });
        (0, vitest_1.it)('group scope does not leak', () => {
            router.group({ prefix: 'api' }, () => {
                router.get('/inside', () => { });
            });
            router.get('/outside', () => { });
            (0, vitest_1.expect)(router.findRoute('GET', '/api/inside')).not.toBeNull();
            (0, vitest_1.expect)(router.findRoute('GET', '/outside')).not.toBeNull();
            (0, vitest_1.expect)(router.findRoute('GET', '/api/outside')).toBeNull();
        });
    });
    (0, vitest_1.describe)('named routes', () => {
        (0, vitest_1.it)('registers and retrieves named routes', () => {
            const route = router.get('/users', () => { });
            router.name('users.index', route);
            (0, vitest_1.expect)(router.getByName('users.index')).toBe(route);
        });
        (0, vitest_1.it)('returns undefined for unknown names', () => {
            (0, vitest_1.expect)(router.getByName('nonexistent')).toBeUndefined();
        });
    });
    (0, vitest_1.describe)('getRoutes()', () => {
        (0, vitest_1.it)('returns all registered routes', () => {
            router.get('/a', () => { });
            router.post('/b', () => { });
            (0, vitest_1.expect)(router.getRoutes()).toHaveLength(2);
        });
    });
});
//# sourceMappingURL=Router.test.js.map