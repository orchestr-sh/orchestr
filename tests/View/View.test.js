"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const View_1 = require("../../src/View/View");
const mockEngine = {
    get: vitest_1.vi.fn(async (path, data) => {
        return `<h1>${data.title || 'Default'}</h1>`;
    }),
};
(0, vitest_1.describe)('View', () => {
    (0, vitest_1.describe)('constructor', () => {
        (0, vitest_1.it)('stores engine, name, path, and data', () => {
            const view = new View_1.View(mockEngine, 'welcome', '/views/welcome.html', { title: 'Hello' });
            (0, vitest_1.expect)(view.name()).toBe('welcome');
            (0, vitest_1.expect)(view.getPath()).toBe('/views/welcome.html');
            (0, vitest_1.expect)(view.getData()).toEqual({ title: 'Hello' });
        });
        (0, vitest_1.it)('defaults data to empty object', () => {
            const view = new View_1.View(mockEngine, 'test', '/test.html');
            (0, vitest_1.expect)(view.getData()).toEqual({});
        });
    });
    (0, vitest_1.describe)('with()', () => {
        (0, vitest_1.it)('adds a single data key', () => {
            const view = new View_1.View(mockEngine, 'test', '/test.html');
            view.with('name', 'John');
            (0, vitest_1.expect)(view.getData()).toEqual({ name: 'John' });
        });
        (0, vitest_1.it)('adds multiple data keys from object', () => {
            const view = new View_1.View(mockEngine, 'test', '/test.html');
            view.with({ a: 1, b: 2 });
            (0, vitest_1.expect)(view.getData()).toEqual({ a: 1, b: 2 });
        });
        (0, vitest_1.it)('returns the view for chaining', () => {
            const view = new View_1.View(mockEngine, 'test', '/test.html');
            (0, vitest_1.expect)(view.with('key', 'val')).toBe(view);
        });
    });
    (0, vitest_1.describe)('render()', () => {
        (0, vitest_1.it)('calls engine.get with path and data', async () => {
            const view = new View_1.View(mockEngine, 'welcome', '/views/welcome.html', { title: 'Test' });
            const html = await view.render();
            (0, vitest_1.expect)(mockEngine.get).toHaveBeenCalledWith('/views/welcome.html', { title: 'Test' });
            (0, vitest_1.expect)(html).toBe('<h1>Test</h1>');
        });
    });
    (0, vitest_1.describe)('toHtml()', () => {
        (0, vitest_1.it)('is an alias for render()', async () => {
            const view = new View_1.View(mockEngine, 'test', '/test.html', { title: 'Alias' });
            const html = await view.toHtml();
            (0, vitest_1.expect)(html).toBe('<h1>Alias</h1>');
        });
    });
    (0, vitest_1.describe)('toString()', () => {
        (0, vitest_1.it)('returns debug string', () => {
            const view = new View_1.View(mockEngine, 'welcome', '/test.html');
            (0, vitest_1.expect)(view.toString()).toBe('[View: welcome]');
        });
    });
});
//# sourceMappingURL=View.test.js.map