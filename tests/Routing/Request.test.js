"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const http_1 = require("http");
const net_1 = require("net");
const Request_1 = require("../../src/Routing/Request");
function createMockIncomingMessage(overrides = {}) {
    const socket = new net_1.Socket();
    const req = new http_1.IncomingMessage(socket);
    req.method = overrides.method || 'GET';
    req.url = overrides.url || '/';
    req.headers = overrides.headers || {};
    return req;
}
(0, vitest_1.describe)('Request', () => {
    (0, vitest_1.describe)('constructor', () => {
        (0, vitest_1.it)('parses method from raw request', () => {
            const req = new Request_1.Request(createMockIncomingMessage({ method: 'POST' }));
            (0, vitest_1.expect)(req.method).toBe('POST');
        });
        (0, vitest_1.it)('defaults method to GET', () => {
            const raw = createMockIncomingMessage();
            raw.method = undefined;
            const req = new Request_1.Request(raw);
            (0, vitest_1.expect)(req.method).toBe('GET');
        });
        (0, vitest_1.it)('parses path from URL', () => {
            const req = new Request_1.Request(createMockIncomingMessage({ url: '/users?page=1' }));
            (0, vitest_1.expect)(req.path).toBe('/users');
        });
        (0, vitest_1.it)('parses query from URL', () => {
            const req = new Request_1.Request(createMockIncomingMessage({ url: '/users?page=1&limit=10' }));
            (0, vitest_1.expect)(req.query.page).toBe('1');
            (0, vitest_1.expect)(req.query.limit).toBe('10');
        });
    });
    (0, vitest_1.describe)('header()', () => {
        (0, vitest_1.it)('gets a header value', () => {
            const req = new Request_1.Request(createMockIncomingMessage({ headers: { 'content-type': 'application/json' } }));
            (0, vitest_1.expect)(req.header('content-type')).toBe('application/json');
        });
        (0, vitest_1.it)('is case-insensitive', () => {
            const req = new Request_1.Request(createMockIncomingMessage({ headers: { 'content-type': 'text/html' } }));
            (0, vitest_1.expect)(req.header('Content-Type')).toBe('text/html');
        });
        (0, vitest_1.it)('returns default for missing header', () => {
            const req = new Request_1.Request(createMockIncomingMessage());
            (0, vitest_1.expect)(req.header('x-custom', 'default')).toBe('default');
        });
    });
    (0, vitest_1.describe)('get() / input()', () => {
        (0, vitest_1.it)('gets query values', () => {
            const req = new Request_1.Request(createMockIncomingMessage({ url: '/?name=John' }));
            (0, vitest_1.expect)(req.get('name')).toBe('John');
            (0, vitest_1.expect)(req.input('name')).toBe('John');
        });
        (0, vitest_1.it)('gets body values', () => {
            const req = new Request_1.Request(createMockIncomingMessage());
            req.body = { email: 'test@example.com' };
            (0, vitest_1.expect)(req.get('email')).toBe('test@example.com');
        });
        (0, vitest_1.it)('prefers query over body', () => {
            const req = new Request_1.Request(createMockIncomingMessage({ url: '/?key=query' }));
            req.body = { key: 'body' };
            (0, vitest_1.expect)(req.get('key')).toBe('query');
        });
        (0, vitest_1.it)('returns default for missing key', () => {
            const req = new Request_1.Request(createMockIncomingMessage());
            (0, vitest_1.expect)(req.get('missing', 'fallback')).toBe('fallback');
        });
    });
    (0, vitest_1.describe)('all()', () => {
        (0, vitest_1.it)('merges query and body', () => {
            const req = new Request_1.Request(createMockIncomingMessage({ url: '/?q=search' }));
            req.body = { page: 1 };
            const all = req.all();
            (0, vitest_1.expect)(all.q).toBe('search');
            (0, vitest_1.expect)(all.page).toBe(1);
        });
    });
    (0, vitest_1.describe)('only()', () => {
        (0, vitest_1.it)('returns only specified keys', () => {
            const req = new Request_1.Request(createMockIncomingMessage({ url: '/?a=1&b=2&c=3' }));
            (0, vitest_1.expect)(req.only(['a', 'b'])).toEqual({ a: '1', b: '2' });
        });
    });
    (0, vitest_1.describe)('except()', () => {
        (0, vitest_1.it)('returns all except specified keys', () => {
            const req = new Request_1.Request(createMockIncomingMessage({ url: '/?a=1&b=2&c=3' }));
            const result = req.except(['c']);
            (0, vitest_1.expect)(result).toHaveProperty('a');
            (0, vitest_1.expect)(result).toHaveProperty('b');
            (0, vitest_1.expect)(result).not.toHaveProperty('c');
        });
    });
    (0, vitest_1.describe)('has()', () => {
        (0, vitest_1.it)('returns true for existing keys', () => {
            const req = new Request_1.Request(createMockIncomingMessage({ url: '/?name=test' }));
            (0, vitest_1.expect)(req.has('name')).toBe(true);
        });
        (0, vitest_1.it)('returns false for missing keys', () => {
            const req = new Request_1.Request(createMockIncomingMessage());
            (0, vitest_1.expect)(req.has('missing')).toBe(false);
        });
    });
    (0, vitest_1.describe)('filled()', () => {
        (0, vitest_1.it)('returns true for non-empty values', () => {
            const req = new Request_1.Request(createMockIncomingMessage({ url: '/?name=John' }));
            (0, vitest_1.expect)(req.filled('name')).toBe(true);
        });
        (0, vitest_1.it)('returns false for empty string', () => {
            const req = new Request_1.Request(createMockIncomingMessage({ url: '/?name=' }));
            (0, vitest_1.expect)(req.filled('name')).toBe(false);
        });
        (0, vitest_1.it)('returns false for missing keys', () => {
            const req = new Request_1.Request(createMockIncomingMessage());
            (0, vitest_1.expect)(req.filled('missing')).toBe(false);
        });
    });
    (0, vitest_1.describe)('ajax()', () => {
        (0, vitest_1.it)('returns true for XMLHttpRequest', () => {
            const req = new Request_1.Request(createMockIncomingMessage({ headers: { 'x-requested-with': 'XMLHttpRequest' } }));
            (0, vitest_1.expect)(req.ajax()).toBe(true);
        });
        (0, vitest_1.it)('returns false for normal requests', () => {
            const req = new Request_1.Request(createMockIncomingMessage());
            (0, vitest_1.expect)(req.ajax()).toBe(false);
        });
    });
    (0, vitest_1.describe)('expectsJson()', () => {
        (0, vitest_1.it)('returns true for JSON accept header', () => {
            const req = new Request_1.Request(createMockIncomingMessage({ headers: { accept: 'application/json' } }));
            (0, vitest_1.expect)(req.expectsJson()).toBe(true);
        });
        (0, vitest_1.it)('returns false without JSON accept', () => {
            const req = new Request_1.Request(createMockIncomingMessage());
            (0, vitest_1.expect)(req.expectsJson()).toBe(false);
        });
    });
    (0, vitest_1.describe)('isJson()', () => {
        (0, vitest_1.it)('returns true for JSON content type', () => {
            const req = new Request_1.Request(createMockIncomingMessage({ headers: { 'content-type': 'application/json' } }));
            (0, vitest_1.expect)(req.isJson()).toBe(true);
        });
    });
    (0, vitest_1.describe)('method helpers', () => {
        (0, vitest_1.it)('getMethod() returns method', () => {
            const req = new Request_1.Request(createMockIncomingMessage({ method: 'POST' }));
            (0, vitest_1.expect)(req.getMethod()).toBe('POST');
        });
        (0, vitest_1.it)('isMethod() compares case-insensitively', () => {
            const req = new Request_1.Request(createMockIncomingMessage({ method: 'POST' }));
            (0, vitest_1.expect)(req.isMethod('post')).toBe(true);
            (0, vitest_1.expect)(req.isMethod('POST')).toBe(true);
            (0, vitest_1.expect)(req.isMethod('get')).toBe(false);
        });
        (0, vitest_1.it)('getUrl() returns full URL', () => {
            const req = new Request_1.Request(createMockIncomingMessage({ url: '/users?page=1' }));
            (0, vitest_1.expect)(req.getUrl()).toBe('/users?page=1');
        });
        (0, vitest_1.it)('getPath() returns path only', () => {
            const req = new Request_1.Request(createMockIncomingMessage({ url: '/users?page=1' }));
            (0, vitest_1.expect)(req.getPath()).toBe('/users');
        });
    });
    (0, vitest_1.describe)('routeParam()', () => {
        (0, vitest_1.it)('returns route parameter', () => {
            const req = new Request_1.Request(createMockIncomingMessage());
            req.params = { id: '42' };
            (0, vitest_1.expect)(req.routeParam('id')).toBe('42');
        });
        (0, vitest_1.it)('returns default for missing param', () => {
            const req = new Request_1.Request(createMockIncomingMessage());
            (0, vitest_1.expect)(req.routeParam('id', 'none')).toBe('none');
        });
    });
});
//# sourceMappingURL=Request.test.js.map