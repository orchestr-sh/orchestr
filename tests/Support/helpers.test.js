"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const helpers_1 = require("../../src/Support/helpers");
const Application_1 = require("../../src/Foundation/Application");
const Config_1 = require("../../src/Foundation/Config/Config");
(0, vitest_1.describe)('helpers', () => {
    (0, vitest_1.describe)('setGlobalApp() / getGlobalApp()', () => {
        (0, vitest_1.afterEach)(() => {
            (0, helpers_1.setGlobalApp)(null);
        });
        (0, vitest_1.it)('sets and gets the global app', () => {
            const app = new Application_1.Application('/test');
            (0, helpers_1.setGlobalApp)(app);
            (0, vitest_1.expect)((0, helpers_1.getGlobalApp)()).toBe(app);
        });
    });
    (0, vitest_1.describe)('config()', () => {
        let app;
        (0, vitest_1.beforeEach)(() => {
            app = new Application_1.Application('/test');
            const configInstance = new Config_1.Config({
                app: { name: 'TestApp', debug: true },
            });
            app.instance('config', configInstance);
            (0, helpers_1.setGlobalApp)(app);
        });
        (0, vitest_1.afterEach)(() => {
            (0, helpers_1.setGlobalApp)(null);
        });
        (0, vitest_1.it)('gets a config value', () => {
            (0, vitest_1.expect)((0, helpers_1.config)('app.name')).toBe('TestApp');
        });
        (0, vitest_1.it)('gets config with default', () => {
            (0, vitest_1.expect)((0, helpers_1.config)('app.missing', 'fallback')).toBe('fallback');
        });
        (0, vitest_1.it)('returns config instance when no key', () => {
            const result = (0, helpers_1.config)();
            (0, vitest_1.expect)(result).toBeInstanceOf(Config_1.Config);
        });
        (0, vitest_1.it)('throws when app not initialized', () => {
            (0, helpers_1.setGlobalApp)(null);
            (0, vitest_1.expect)(() => (0, helpers_1.config)('anything')).toThrow('Application not initialized');
        });
    });
    (0, vitest_1.describe)('base_path()', () => {
        (0, vitest_1.it)('returns cwd', () => {
            (0, vitest_1.expect)((0, helpers_1.base_path)()).toBe(process.cwd());
        });
        (0, vitest_1.it)('appends path', () => {
            (0, vitest_1.expect)((0, helpers_1.base_path)('app')).toBe(`${process.cwd()}/app`);
        });
    });
    (0, vitest_1.describe)('routes_path()', () => {
        (0, vitest_1.it)('returns routes directory', () => {
            (0, vitest_1.expect)((0, helpers_1.routes_path)()).toBe(`${process.cwd()}/routes`);
        });
        (0, vitest_1.it)('appends path', () => {
            (0, vitest_1.expect)((0, helpers_1.routes_path)('web.ts')).toBe(`${process.cwd()}/routes/web.ts`);
        });
    });
    (0, vitest_1.describe)('resource_path()', () => {
        (0, vitest_1.it)('returns resources directory', () => {
            (0, vitest_1.expect)((0, helpers_1.resource_path)()).toBe(`${process.cwd()}/resources`);
        });
        (0, vitest_1.it)('appends path', () => {
            (0, vitest_1.expect)((0, helpers_1.resource_path)('views')).toBe(`${process.cwd()}/resources/views`);
        });
    });
});
//# sourceMappingURL=helpers.test.js.map