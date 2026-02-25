"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const http_1 = require("http");
const net_1 = require("net");
const Response_1 = require("../../src/Routing/Response");
function createMockServerResponse() {
    const socket = new net_1.Socket();
    const req = new http_1.IncomingMessage(socket);
    const res = new http_1.ServerResponse(req);
    res.end = vitest_1.vi.fn();
    res.setHeader = vitest_1.vi.fn();
    return res;
}
(0, vitest_1.describe)('Response', () => {
    let raw;
    let response;
    (0, vitest_1.beforeEach)(() => {
        raw = createMockServerResponse();
        response = new Response_1.Response(raw);
    });
    (0, vitest_1.describe)('status()', () => {
        (0, vitest_1.it)('sets status code', () => {
            response.status(404);
            response.send('Not Found');
            (0, vitest_1.expect)(raw.statusCode).toBe(404);
        });
        (0, vitest_1.it)('returns the response for chaining', () => {
            (0, vitest_1.expect)(response.status(200)).toBe(response);
        });
    });
    (0, vitest_1.describe)('header()', () => {
        (0, vitest_1.it)('sets a response header', () => {
            response.header('X-Custom', 'value');
            response.send('test');
            (0, vitest_1.expect)(raw.setHeader).toHaveBeenCalledWith('X-Custom', 'value');
        });
        (0, vitest_1.it)('returns the response for chaining', () => {
            (0, vitest_1.expect)(response.header('X-Test', 'val')).toBe(response);
        });
    });
    (0, vitest_1.describe)('headers()', () => {
        (0, vitest_1.it)('sets multiple headers', () => {
            response.headers({ 'X-A': '1', 'X-B': '2' });
            response.send('test');
            (0, vitest_1.expect)(raw.setHeader).toHaveBeenCalledWith('X-A', '1');
            (0, vitest_1.expect)(raw.setHeader).toHaveBeenCalledWith('X-B', '2');
        });
    });
    (0, vitest_1.describe)('send()', () => {
        (0, vitest_1.it)('sends string data', () => {
            response.send('Hello');
            (0, vitest_1.expect)(raw.end).toHaveBeenCalledWith('Hello');
            (0, vitest_1.expect)(response.finished).toBe(true);
        });
        (0, vitest_1.it)('sends null data', () => {
            response.send(null);
            (0, vitest_1.expect)(raw.end).toHaveBeenCalledWith();
        });
        (0, vitest_1.it)('sends numeric data as string', () => {
            response.send(42);
            (0, vitest_1.expect)(raw.end).toHaveBeenCalledWith('42');
        });
        (0, vitest_1.it)('does not send twice', () => {
            response.send('first');
            response.send('second');
            (0, vitest_1.expect)(raw.end).toHaveBeenCalledTimes(1);
        });
    });
    (0, vitest_1.describe)('json()', () => {
        (0, vitest_1.it)('sends JSON response', () => {
            response.json({ key: 'value' });
            (0, vitest_1.expect)(raw.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json');
            (0, vitest_1.expect)(raw.end).toHaveBeenCalledWith(JSON.stringify({ key: 'value' }));
            (0, vitest_1.expect)(response.finished).toBe(true);
        });
        (0, vitest_1.it)('sets custom status code', () => {
            response.json({ error: 'Not Found' }, 404);
            (0, vitest_1.expect)(raw.statusCode).toBe(404);
        });
        (0, vitest_1.it)('does not send twice', () => {
            response.json({ a: 1 });
            response.json({ b: 2 });
            (0, vitest_1.expect)(raw.end).toHaveBeenCalledTimes(1);
        });
    });
    (0, vitest_1.describe)('redirect()', () => {
        (0, vitest_1.it)('sends redirect response', () => {
            response.redirect('/new-location');
            (0, vitest_1.expect)(raw.statusCode).toBe(302);
            (0, vitest_1.expect)(raw.setHeader).toHaveBeenCalledWith('Location', '/new-location');
            (0, vitest_1.expect)(raw.end).toHaveBeenCalled();
            (0, vitest_1.expect)(response.finished).toBe(true);
        });
        (0, vitest_1.it)('accepts custom status code', () => {
            response.redirect('/permanent', 301);
            (0, vitest_1.expect)(raw.statusCode).toBe(301);
        });
    });
    (0, vitest_1.describe)('download()', () => {
        (0, vitest_1.it)('sends download response', () => {
            response.download(Buffer.from('file content'), 'test.txt');
            (0, vitest_1.expect)(raw.setHeader).toHaveBeenCalledWith('Content-Disposition', 'attachment; filename="test.txt"');
            (0, vitest_1.expect)(raw.setHeader).toHaveBeenCalledWith('Content-Type', 'application/octet-stream');
        });
    });
    (0, vitest_1.describe)('cookie()', () => {
        (0, vitest_1.it)('sets cookies on the response', () => {
            response.cookie('session', 'abc123', { httpOnly: true, secure: true });
            response.send('ok');
            (0, vitest_1.expect)(raw.setHeader).toHaveBeenCalledWith('Set-Cookie', vitest_1.expect.arrayContaining([vitest_1.expect.stringContaining('session=abc123')]));
        });
        (0, vitest_1.it)('serializes cookie with options', () => {
            response.cookie('token', 'xyz', {
                maxAge: 3600,
                domain: 'example.com',
                path: '/api',
                httpOnly: true,
                secure: true,
                sameSite: 'Strict',
            });
            response.send('ok');
            const setCookieCall = raw.setHeader.mock.calls.find((c) => c[0] === 'Set-Cookie');
            const cookieStr = setCookieCall[1][0];
            (0, vitest_1.expect)(cookieStr).toContain('Max-Age=3600');
            (0, vitest_1.expect)(cookieStr).toContain('Domain=example.com');
            (0, vitest_1.expect)(cookieStr).toContain('Path=/api');
            (0, vitest_1.expect)(cookieStr).toContain('HttpOnly');
            (0, vitest_1.expect)(cookieStr).toContain('Secure');
            (0, vitest_1.expect)(cookieStr).toContain('SameSite=Strict');
        });
        (0, vitest_1.it)('uses default path=/ when no path specified', () => {
            response.cookie('name', 'value');
            response.send('ok');
            const setCookieCall = raw.setHeader.mock.calls.find((c) => c[0] === 'Set-Cookie');
            const cookieStr = setCookieCall[1][0];
            (0, vitest_1.expect)(cookieStr).toContain('Path=/');
        });
    });
});
//# sourceMappingURL=Response.test.js.map