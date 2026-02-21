import { describe, it, expect } from 'vitest';
import { IncomingMessage } from 'http';
import { Socket } from 'net';
import { Request } from '@/Routing/Request';

function createMockIncomingMessage(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  const socket = new Socket();
  const req = new IncomingMessage(socket);
  req.method = overrides.method || 'GET';
  req.url = overrides.url || '/';
  req.headers = overrides.headers || {};
  return req;
}

describe('Request', () => {
  describe('constructor', () => {
    it('parses method from raw request', () => {
      const req = new Request(createMockIncomingMessage({ method: 'POST' }));
      expect(req.method).toBe('POST');
    });

    it('defaults method to GET', () => {
      const raw = createMockIncomingMessage();
      raw.method = undefined;
      const req = new Request(raw);
      expect(req.method).toBe('GET');
    });

    it('parses path from URL', () => {
      const req = new Request(createMockIncomingMessage({ url: '/users?page=1' }));
      expect(req.path).toBe('/users');
    });

    it('parses query from URL', () => {
      const req = new Request(createMockIncomingMessage({ url: '/users?page=1&limit=10' }));
      expect(req.query.page).toBe('1');
      expect(req.query.limit).toBe('10');
    });
  });

  describe('header()', () => {
    it('gets a header value', () => {
      const req = new Request(createMockIncomingMessage({ headers: { 'content-type': 'application/json' } }));
      expect(req.header('content-type')).toBe('application/json');
    });

    it('is case-insensitive', () => {
      const req = new Request(createMockIncomingMessage({ headers: { 'content-type': 'text/html' } }));
      expect(req.header('Content-Type')).toBe('text/html');
    });

    it('returns default for missing header', () => {
      const req = new Request(createMockIncomingMessage());
      expect(req.header('x-custom', 'default')).toBe('default');
    });
  });

  describe('get() / input()', () => {
    it('gets query values', () => {
      const req = new Request(createMockIncomingMessage({ url: '/?name=John' }));
      expect(req.get('name')).toBe('John');
      expect(req.input('name')).toBe('John');
    });

    it('gets body values', () => {
      const req = new Request(createMockIncomingMessage());
      req.body = { email: 'test@example.com' };
      expect(req.get('email')).toBe('test@example.com');
    });

    it('prefers query over body', () => {
      const req = new Request(createMockIncomingMessage({ url: '/?key=query' }));
      req.body = { key: 'body' };
      expect(req.get('key')).toBe('query');
    });

    it('returns default for missing key', () => {
      const req = new Request(createMockIncomingMessage());
      expect(req.get('missing', 'fallback')).toBe('fallback');
    });
  });

  describe('all()', () => {
    it('merges query and body', () => {
      const req = new Request(createMockIncomingMessage({ url: '/?q=search' }));
      req.body = { page: 1 };
      const all = req.all();
      expect(all.q).toBe('search');
      expect(all.page).toBe(1);
    });
  });

  describe('only()', () => {
    it('returns only specified keys', () => {
      const req = new Request(createMockIncomingMessage({ url: '/?a=1&b=2&c=3' }));
      expect(req.only(['a', 'b'])).toEqual({ a: '1', b: '2' });
    });
  });

  describe('except()', () => {
    it('returns all except specified keys', () => {
      const req = new Request(createMockIncomingMessage({ url: '/?a=1&b=2&c=3' }));
      const result = req.except(['c']);
      expect(result).toHaveProperty('a');
      expect(result).toHaveProperty('b');
      expect(result).not.toHaveProperty('c');
    });
  });

  describe('has()', () => {
    it('returns true for existing keys', () => {
      const req = new Request(createMockIncomingMessage({ url: '/?name=test' }));
      expect(req.has('name')).toBe(true);
    });

    it('returns false for missing keys', () => {
      const req = new Request(createMockIncomingMessage());
      expect(req.has('missing')).toBe(false);
    });
  });

  describe('filled()', () => {
    it('returns true for non-empty values', () => {
      const req = new Request(createMockIncomingMessage({ url: '/?name=John' }));
      expect(req.filled('name')).toBe(true);
    });

    it('returns false for empty string', () => {
      const req = new Request(createMockIncomingMessage({ url: '/?name=' }));
      expect(req.filled('name')).toBe(false);
    });

    it('returns false for missing keys', () => {
      const req = new Request(createMockIncomingMessage());
      expect(req.filled('missing')).toBe(false);
    });
  });

  describe('ajax()', () => {
    it('returns true for XMLHttpRequest', () => {
      const req = new Request(createMockIncomingMessage({ headers: { 'x-requested-with': 'XMLHttpRequest' } }));
      expect(req.ajax()).toBe(true);
    });

    it('returns false for normal requests', () => {
      const req = new Request(createMockIncomingMessage());
      expect(req.ajax()).toBe(false);
    });
  });

  describe('expectsJson()', () => {
    it('returns true for JSON accept header', () => {
      const req = new Request(createMockIncomingMessage({ headers: { accept: 'application/json' } }));
      expect(req.expectsJson()).toBe(true);
    });

    it('returns false without JSON accept', () => {
      const req = new Request(createMockIncomingMessage());
      expect(req.expectsJson()).toBe(false);
    });
  });

  describe('isJson()', () => {
    it('returns true for JSON content type', () => {
      const req = new Request(createMockIncomingMessage({ headers: { 'content-type': 'application/json' } }));
      expect(req.isJson()).toBe(true);
    });
  });

  describe('method helpers', () => {
    it('getMethod() returns method', () => {
      const req = new Request(createMockIncomingMessage({ method: 'POST' }));
      expect(req.getMethod()).toBe('POST');
    });

    it('isMethod() compares case-insensitively', () => {
      const req = new Request(createMockIncomingMessage({ method: 'POST' }));
      expect(req.isMethod('post')).toBe(true);
      expect(req.isMethod('POST')).toBe(true);
      expect(req.isMethod('get')).toBe(false);
    });

    it('getUrl() returns full URL', () => {
      const req = new Request(createMockIncomingMessage({ url: '/users?page=1' }));
      expect(req.getUrl()).toBe('/users?page=1');
    });

    it('getPath() returns path only', () => {
      const req = new Request(createMockIncomingMessage({ url: '/users?page=1' }));
      expect(req.getPath()).toBe('/users');
    });
  });

  describe('routeParam()', () => {
    it('returns route parameter', () => {
      const req = new Request(createMockIncomingMessage());
      req.params = { id: '42' };
      expect(req.routeParam('id')).toBe('42');
    });

    it('returns default for missing param', () => {
      const req = new Request(createMockIncomingMessage());
      expect(req.routeParam('id', 'none')).toBe('none');
    });
  });
});
