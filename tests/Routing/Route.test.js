"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const Route_1 = require("../../src/Routing/Route");
(0, vitest_1.describe)('Route', () => {
    (0, vitest_1.describe)('constructor', () => {
        (0, vitest_1.it)('normalizes single method to array', () => {
            const route = new Route_1.Route('GET', '/test', () => { });
            (0, vitest_1.expect)(route.methods).toEqual(['GET']);
        });
        (0, vitest_1.it)('accepts array of methods', () => {
            const route = new Route_1.Route(['GET', 'POST'], '/test', () => { });
            (0, vitest_1.expect)(route.methods).toEqual(['GET', 'POST']);
        });
    });
    (0, vitest_1.describe)('matches()', () => {
        (0, vitest_1.it)('matches exact paths', () => {
            const route = new Route_1.Route('GET', '/users', () => { });
            (0, vitest_1.expect)(route.matches('GET', '/users')).toBe(true);
        });
        (0, vitest_1.it)('rejects wrong method', () => {
            const route = new Route_1.Route('GET', '/users', () => { });
            (0, vitest_1.expect)(route.matches('POST', '/users')).toBe(false);
        });
        (0, vitest_1.it)('rejects wrong path', () => {
            const route = new Route_1.Route('GET', '/users', () => { });
            (0, vitest_1.expect)(route.matches('GET', '/posts')).toBe(false);
        });
        (0, vitest_1.it)('matches route parameters', () => {
            const route = new Route_1.Route('GET', '/users/:id', () => { });
            (0, vitest_1.expect)(route.matches('GET', '/users/123')).toBe(true);
            (0, vitest_1.expect)(route.matches('GET', '/users/abc')).toBe(true);
        });
        (0, vitest_1.it)('matches multiple parameters', () => {
            const route = new Route_1.Route('GET', '/users/:userId/posts/:postId', () => { });
            (0, vitest_1.expect)(route.matches('GET', '/users/1/posts/42')).toBe(true);
        });
        (0, vitest_1.it)('rejects partial path matches', () => {
            const route = new Route_1.Route('GET', '/users', () => { });
            (0, vitest_1.expect)(route.matches('GET', '/users/extra')).toBe(false);
        });
    });
    (0, vitest_1.describe)('bind()', () => {
        (0, vitest_1.it)('extracts parameter values', () => {
            const route = new Route_1.Route('GET', '/users/:id', () => { });
            route.bind('/users/42');
            (0, vitest_1.expect)(route.getParameters()).toEqual({ id: '42' });
        });
        (0, vitest_1.it)('extracts multiple parameters', () => {
            const route = new Route_1.Route('GET', '/users/:userId/posts/:postId', () => { });
            route.bind('/users/1/posts/99');
            (0, vitest_1.expect)(route.getParameters()).toEqual({ userId: '1', postId: '99' });
        });
    });
    (0, vitest_1.describe)('parameter()', () => {
        (0, vitest_1.it)('returns specific parameter value', () => {
            const route = new Route_1.Route('GET', '/users/:id', () => { });
            route.bind('/users/5');
            (0, vitest_1.expect)(route.parameter('id')).toBe('5');
        });
        (0, vitest_1.it)('returns default for missing parameter', () => {
            const route = new Route_1.Route('GET', '/users/:id', () => { });
            route.bind('/users/5');
            (0, vitest_1.expect)(route.parameter('name', 'unknown')).toBe('unknown');
        });
    });
    (0, vitest_1.describe)('addMiddleware()', () => {
        (0, vitest_1.it)('adds a single middleware', () => {
            const route = new Route_1.Route('GET', '/test', () => { });
            const mw = vitest_1.vi.fn();
            route.addMiddleware(mw);
            (0, vitest_1.expect)(route.middleware).toContain(mw);
        });
        (0, vitest_1.it)('adds array of middleware', () => {
            const route = new Route_1.Route('GET', '/test', () => { });
            const mw1 = vitest_1.vi.fn();
            const mw2 = vitest_1.vi.fn();
            route.addMiddleware([mw1, mw2]);
            (0, vitest_1.expect)(route.middleware).toContain(mw1);
            (0, vitest_1.expect)(route.middleware).toContain(mw2);
        });
        (0, vitest_1.it)('returns the route for chaining', () => {
            const route = new Route_1.Route('GET', '/test', () => { });
            const result = route.addMiddleware(vitest_1.vi.fn());
            (0, vitest_1.expect)(result).toBe(route);
        });
    });
    (0, vitest_1.describe)('setName()', () => {
        (0, vitest_1.it)('sets the route name', () => {
            const route = new Route_1.Route('GET', '/users', () => { });
            route.setName('users.index');
            (0, vitest_1.expect)(route.name).toBe('users.index');
        });
        (0, vitest_1.it)('returns the route for chaining', () => {
            const route = new Route_1.Route('GET', '/test', () => { });
            const result = route.setName('test');
            (0, vitest_1.expect)(result).toBe(route);
        });
    });
});
//# sourceMappingURL=Route.test.js.map