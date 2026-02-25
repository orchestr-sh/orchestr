import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ServerResponse, IncomingMessage } from 'http';
import { Socket } from 'net';
import { Response } from '@/Routing/Response';

function createMockServerResponse(): ServerResponse {
  const socket = new Socket();
  const req = new IncomingMessage(socket);
  const res = new ServerResponse(req);
  res.end = vi.fn() as any;
  res.setHeader = vi.fn() as any;
  return res;
}

describe('Response', () => {
  let raw: ServerResponse;
  let response: Response;

  beforeEach(() => {
    raw = createMockServerResponse();
    response = new Response(raw);
  });

  describe('status()', () => {
    it('sets status code', () => {
      response.status(404);
      response.send('Not Found');
      expect(raw.statusCode).toBe(404);
    });

    it('returns the response for chaining', () => {
      expect(response.status(200)).toBe(response);
    });
  });

  describe('header()', () => {
    it('sets a response header', () => {
      response.header('X-Custom', 'value');
      response.send('test');
      expect(raw.setHeader).toHaveBeenCalledWith('X-Custom', 'value');
    });

    it('returns the response for chaining', () => {
      expect(response.header('X-Test', 'val')).toBe(response);
    });
  });

  describe('headers()', () => {
    it('sets multiple headers', () => {
      response.headers({ 'X-A': '1', 'X-B': '2' });
      response.send('test');
      expect(raw.setHeader).toHaveBeenCalledWith('X-A', '1');
      expect(raw.setHeader).toHaveBeenCalledWith('X-B', '2');
    });
  });

  describe('send()', () => {
    it('sends string data', () => {
      response.send('Hello');
      expect(raw.end).toHaveBeenCalledWith('Hello');
      expect(response.finished).toBe(true);
    });

    it('sends null data', () => {
      response.send(null);
      expect(raw.end).toHaveBeenCalledWith();
    });

    it('sends numeric data as string', () => {
      response.send(42);
      expect(raw.end).toHaveBeenCalledWith('42');
    });

    it('does not send twice', () => {
      response.send('first');
      response.send('second');
      expect(raw.end).toHaveBeenCalledTimes(1);
    });
  });

  describe('json()', () => {
    it('sends JSON response', () => {
      response.json({ key: 'value' });
      expect(raw.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json');
      expect(raw.end).toHaveBeenCalledWith(JSON.stringify({ key: 'value' }));
      expect(response.finished).toBe(true);
    });

    it('sets custom status code', () => {
      response.json({ error: 'Not Found' }, 404);
      expect(raw.statusCode).toBe(404);
    });

    it('does not send twice', () => {
      response.json({ a: 1 });
      response.json({ b: 2 });
      expect(raw.end).toHaveBeenCalledTimes(1);
    });
  });

  describe('redirect()', () => {
    it('sends redirect response', () => {
      response.redirect('/new-location');
      expect(raw.statusCode).toBe(302);
      expect(raw.setHeader).toHaveBeenCalledWith('Location', '/new-location');
      expect(raw.end).toHaveBeenCalled();
      expect(response.finished).toBe(true);
    });

    it('accepts custom status code', () => {
      response.redirect('/permanent', 301);
      expect(raw.statusCode).toBe(301);
    });
  });

  describe('download()', () => {
    it('sends download response', () => {
      response.download(Buffer.from('file content'), 'test.txt');
      expect(raw.setHeader).toHaveBeenCalledWith('Content-Disposition', 'attachment; filename="test.txt"');
      expect(raw.setHeader).toHaveBeenCalledWith('Content-Type', 'application/octet-stream');
    });
  });

  describe('cookie()', () => {
    it('sets cookies on the response', () => {
      response.cookie('session', 'abc123', { httpOnly: true, secure: true });
      response.send('ok');
      expect(raw.setHeader).toHaveBeenCalledWith(
        'Set-Cookie',
        expect.arrayContaining([expect.stringContaining('session=abc123')])
      );
    });

    it('serializes cookie with options', () => {
      response.cookie('token', 'xyz', {
        maxAge: 3600,
        domain: 'example.com',
        path: '/api',
        httpOnly: true,
        secure: true,
        sameSite: 'Strict',
      });
      response.send('ok');

      const setCookieCall = (raw.setHeader as any).mock.calls.find((c: any) => c[0] === 'Set-Cookie');
      const cookieStr = setCookieCall[1][0];
      expect(cookieStr).toContain('Max-Age=3600');
      expect(cookieStr).toContain('Domain=example.com');
      expect(cookieStr).toContain('Path=/api');
      expect(cookieStr).toContain('HttpOnly');
      expect(cookieStr).toContain('Secure');
      expect(cookieStr).toContain('SameSite=Strict');
    });

    it('uses default path=/ when no path specified', () => {
      response.cookie('name', 'value');
      response.send('ok');
      const setCookieCall = (raw.setHeader as any).mock.calls.find((c: any) => c[0] === 'Set-Cookie');
      const cookieStr = setCookieCall[1][0];
      expect(cookieStr).toContain('Path=/');
    });
  });
});
