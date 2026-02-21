"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const ViewFactory_1 = require("../../src/View/ViewFactory");
const View_1 = require("../../src/View/View");
const fs_1 = require("fs");
const path_1 = require("path");
const os_1 = require("os");
const mockEngine = {
    get: async (_path, _data) => '<html></html>',
};
(0, vitest_1.describe)('ViewFactory', () => {
    let viewDir;
    let factory;
    (0, vitest_1.beforeEach)(() => {
        viewDir = (0, path_1.join)((0, os_1.tmpdir)(), `orchestr-test-views-${Date.now()}`);
        (0, fs_1.mkdirSync)(viewDir, { recursive: true });
        (0, fs_1.mkdirSync)((0, path_1.join)(viewDir, 'layouts'), { recursive: true });
        (0, fs_1.mkdirSync)((0, path_1.join)(viewDir, 'emails'), { recursive: true });
        (0, fs_1.writeFileSync)((0, path_1.join)(viewDir, 'welcome.html'), '<h1>Welcome</h1>');
        (0, fs_1.writeFileSync)((0, path_1.join)(viewDir, 'layouts', 'app.html'), '<html>@yield("content")</html>');
        (0, fs_1.writeFileSync)((0, path_1.join)(viewDir, 'emails', 'invoice.html'), '<p>Invoice</p>');
        factory = new ViewFactory_1.ViewFactory(mockEngine, [viewDir]);
    });
    (0, vitest_1.afterEach)(() => {
        if ((0, fs_1.existsSync)(viewDir)) {
            (0, fs_1.rmSync)(viewDir, { recursive: true });
        }
    });
    (0, vitest_1.describe)('make()', () => {
        (0, vitest_1.it)('creates a View instance', () => {
            const view = factory.make('welcome');
            (0, vitest_1.expect)(view).toBeInstanceOf(View_1.View);
        });
        (0, vitest_1.it)('resolves dot-notation names', () => {
            const view = factory.make('layouts.app');
            (0, vitest_1.expect)(view.getPath()).toBe((0, path_1.join)(viewDir, 'layouts', 'app.html'));
        });
        (0, vitest_1.it)('merges shared data with view data', () => {
            factory.share('appName', 'Orchestr');
            const view = factory.make('welcome', { page: 'home' });
            (0, vitest_1.expect)(view.getData()).toEqual({ appName: 'Orchestr', page: 'home' });
        });
        (0, vitest_1.it)('view data overrides shared data', () => {
            factory.share('title', 'Default');
            const view = factory.make('welcome', { title: 'Custom' });
            (0, vitest_1.expect)(view.getData().title).toBe('Custom');
        });
    });
    (0, vitest_1.describe)('exists()', () => {
        (0, vitest_1.it)('returns true for existing views', () => {
            (0, vitest_1.expect)(factory.exists('welcome')).toBe(true);
        });
        (0, vitest_1.it)('returns true for nested views', () => {
            (0, vitest_1.expect)(factory.exists('emails.invoice')).toBe(true);
        });
        (0, vitest_1.it)('returns false for missing views', () => {
            (0, vitest_1.expect)(factory.exists('nonexistent')).toBe(false);
        });
    });
    (0, vitest_1.describe)('share()', () => {
        (0, vitest_1.it)('shares data with string key', () => {
            factory.share('key', 'value');
            (0, vitest_1.expect)(factory.getShared()).toEqual({ key: 'value' });
        });
        (0, vitest_1.it)('shares data with object', () => {
            factory.share({ a: 1, b: 2 });
            (0, vitest_1.expect)(factory.getShared()).toEqual({ a: 1, b: 2 });
        });
    });
    (0, vitest_1.describe)('addLocation()', () => {
        (0, vitest_1.it)('adds a new view path', () => {
            factory.addLocation('/extra/views');
            (0, vitest_1.expect)(factory.getPaths()).toContain('/extra/views');
        });
    });
    (0, vitest_1.describe)('findView()', () => {
        (0, vitest_1.it)('resolves a view name to path', () => {
            const path = factory.findView('welcome');
            (0, vitest_1.expect)(path).toBe((0, path_1.join)(viewDir, 'welcome.html'));
        });
        (0, vitest_1.it)('throws for non-existent views', () => {
            (0, vitest_1.expect)(() => factory.findView('missing')).toThrow('View [missing] not found');
        });
    });
});
//# sourceMappingURL=ViewFactory.test.js.map