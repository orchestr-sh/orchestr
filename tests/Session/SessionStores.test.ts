import { existsSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Store } from '@/Session/Contracts/Store';
import { ArraySessionStore } from '@/Session/Stores/ArraySessionStore';
import { CookieSessionStore } from '@/Session/Stores/CookieSessionStore';
import { FileSessionStore } from '@/Session/Stores/FileSessionStore';

describe('session stores', () => {
  // ---------------------------------------------------------------------
  // Shared contract behaviour, exercised on each driver. `reload` mirrors
  // what the middleware does for the next request: ID-carrying drivers get
  // the session cookie back as their ID, the cookie driver gets the signed
  // payload.
  // ---------------------------------------------------------------------

  const cookieConfig = { driver: 'cookie', lifetime: 120, key: 'test-key' };

  const drivers: Array<[string, () => Store, (previous: Store) => Store]> = [
    [
      'array',
      () => new ArraySessionStore({ driver: 'array', lifetime: 120 }),
      (previous) => new ArraySessionStore({ driver: 'array', lifetime: 120 }, previous.getId()),
    ],
    [
      'file',
      () => new FileSessionStore({ driver: 'file', path: fileDirectory(), lifetime: 120 }),
      (previous) => new FileSessionStore({ driver: 'file', path: fileDirectory(), lifetime: 120 }, previous.getId()),
    ],
    [
      'cookie',
      () => new CookieSessionStore(cookieConfig),
      (previous) => {
        const next = new CookieSessionStore(cookieConfig);
        next.loadRawPayload(previous.getCookieValue());

        return next;
      },
    ],
  ];

  let directory: string;

  function fileDirectory(): string {
    return directory;
  }

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'orchestr-sessions-'));
    ArraySessionStore.clear();
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
    vi.useRealTimers();
  });

  describe.each(drivers)('%s driver', (_name, factory, reload) => {
    it('carries attributes through the put/get/has/missing/forget cycle', () => {
      const store = factory();
      store.start();

      expect(store.has('name')).toBe(false);
      expect(store.missing('name')).toBe(true);

      store.put('name', 'ada');

      expect(store.get('name')).toBe('ada');
      expect(store.has('name')).toBe(true);
      expect(store.missing('name')).toBe(false);

      store.forget('name');

      expect(store.get('name')).toBeUndefined();
    });

    it('supports dot notation, set() aliases and default values', () => {
      const store = factory();
      store.start();

      store.set('user.name', 'ada');

      expect(store.get('user.name')).toBe('ada');
      expect(store.get('user.age', 36)).toBe(36);

      store.forget('user.name');
      expect(store.missing('user.name')).toBe(true);
    });

    it('survives to the next request', () => {
      const store = factory();
      store.start();
      store.put('greeting', 'hello');
      store.save();

      const followUp = reload(store);
      followUp.start();

      expect(followUp.getId()).toBe(store.getId());
      expect(followUp.get('greeting')).toBe('hello');
    });

    it('starts an empty session when no stored payload exists', () => {
      const store = factory();
      store.start();

      expect(store.get('anything')).toBeUndefined();
      expect(store.getId()).toMatch(/^[a-zA-Z0-9]{40}$/);
    });

    it('regenerate() changes the ID and preserves the data', () => {
      const store = factory();
      store.start();
      store.put('greeting', 'hello');

      const before = store.getId();
      store.regenerate();
      store.save();

      expect(store.getId()).not.toBe(before);
      expect(store.get('greeting')).toBe('hello');

      const followUp = reload(store);
      followUp.start();
      expect(followUp.getId()).toBe(store.getId());
      expect(followUp.get('greeting')).toBe('hello');
    });

    it('invalidate() clears data and forgets the old session', () => {
      const store = factory();
      store.start();
      store.put('greeting', 'hello');
      store.save();

      const previous = reload(store);
      previous.start();

      const oldId = previous.getId();
      previous.invalidate();
      previous.save();

      expect(previous.getId()).not.toBe(oldId);
      expect(previous.get('greeting')).toBeUndefined();
      expect(previous.token()).toMatch(/^[a-zA-Z0-9]{40}$/);

      const resurrected = factory();
      resurrected.start();
      expect(resurrected.get('greeting')).toBeUndefined();
    });

    it('flush() removes every attribute', () => {
      const store = factory();
      store.start();
      store.put('a', 1);
      store.put('b', 2);

      store.flush();

      expect(Object.keys(store.all())).toHaveLength(0);
    });

    it('flashes data for exactly one subsequent request', () => {
      const store = factory();
      store.start();
      store.flash('status', 'Created');
      store.save();

      const next = reload(store);
      next.start();
      expect(next.get('status')).toBe('Created');
      next.save();

      const later = reload(next);
      later.start();
      expect(later.get('status')).toBeUndefined();
    });

    it('reflash() keeps every flash entry for one more request', () => {
      const store = factory();
      store.start();
      store.flash('status', 'Created');
      store.flash('errors', ['name required']);
      store.save();

      const next = reload(store);
      next.start();
      next.reflash();
      next.save();

      const following = reload(next);
      following.start();
      expect(following.get('status')).toBe('Created');
      expect(following.get('errors')).toEqual(['name required']);
      following.save();

      const last = reload(following);
      last.start();
      expect(last.get('status')).toBeUndefined();
      expect(last.get('errors')).toBeUndefined();
    });

    it('keep() preserves only the named flash keys', () => {
      const store = factory();
      store.start();
      store.flash('kept', 'yes');
      store.flash('dropped', 'no');
      store.save();

      const next = reload(store);
      next.start();
      next.keep('kept');
      next.save();

      const following = reload(next);
      following.start();
      expect(following.get('kept')).toBe('yes');
      expect(following.get('dropped')).toBeUndefined();
    });

    it('keeps a stable CSRF token across requests until it is regenerated', () => {
      const store = factory();
      store.start();

      const token = store.token();
      expect(token).toMatch(/^[a-zA-Z0-9]{40}$/);
      expect(store.token()).toBe(token);
      store.save();

      const next = reload(store);
      next.start();
      expect(next.token()).toBe(token);

      const fresh = next.regenerateToken();
      expect(fresh).not.toBe(token);
      expect(next.token()).toBe(fresh);
    });

    it('reports start state through isStarted()', () => {
      const store = factory();

      expect(store.isStarted()).toBe(false);
      store.start();
      expect(store.isStarted()).toBe(true);
    });
  });

  // -------------------------------------------------------------------
  // Driver-specific persistence
  // -------------------------------------------------------------------

  describe('array driver', () => {
    it('drops payloads that outlived the lifetime', () => {
      vi.useFakeTimers({ now: new Date() });

      const store = new ArraySessionStore({ driver: 'array', lifetime: 120 });
      store.start();
      store.put('greeting', 'hello');
      store.save();

      vi.setSystemTime(new Date(Date.now() + 121 * 60 * 1000));

      const late = new ArraySessionStore({ driver: 'array', lifetime: 120 }, store.getId());
      late.start();

      expect(late.get('greeting')).toBeUndefined();
    });

    it('isolates sessions from each other', () => {
      const one = new ArraySessionStore({ driver: 'array' });
      const two = new ArraySessionStore({ driver: 'array' });
      one.start();
      two.start();

      one.put('owner', 'one');
      one.save();
      two.save();

      const oneAgain = new ArraySessionStore({ driver: 'array' }, one.getId());
      oneAgain.start();
      expect(oneAgain.get('owner')).toBe('one');

      const twoAgain = new ArraySessionStore({ driver: 'array' }, two.getId());
      twoAgain.start();
      expect(twoAgain.get('owner')).toBeUndefined();
    });
  });

  describe('file driver', () => {
    it('writes one sess_<id> file and leaves no temporary litter', () => {
      const store = new FileSessionStore({ driver: 'file', path: directory, lifetime: 120 });
      store.start();
      store.put('greeting', 'hello');
      store.save();

      const files = readdirSync(directory);

      expect(files).toEqual([`sess_${store.getId()}`]);
    });

    it('rejects expired payloads and removes their file', () => {
      vi.useFakeTimers({ now: new Date() });

      const store = new FileSessionStore({ driver: 'file', path: directory, lifetime: 120 });
      store.start();
      store.put('greeting', 'hello');
      store.save();
      const file = join(directory, `sess_${store.getId()}`);

      vi.setSystemTime(new Date(Date.now() + 121 * 60 * 1000));

      const late = new FileSessionStore({ driver: 'file', path: directory, lifetime: 120 }, store.getId());
      late.start();

      expect(late.get('greeting')).toBeUndefined();
      expect(existsSync(file)).toBe(false);
    });

    it('gc() collects stale files and keeps fresh ones', () => {
      const store = new FileSessionStore({ driver: 'file', path: directory, lifetime: 120 });
      store.start();
      store.save();

      const stale = join(directory, `sess_${'b'.repeat(40)}`);
      writeFileSync(stale, JSON.stringify({ expires: 0, data: {} }), 'utf-8');
      const longAgo = new Date(Date.now() - 130 * 60 * 1000);
      utimesSync(stale, longAgo, longAgo);

      const removed = store.gc();

      expect(removed).toBe(1);
      expect(existsSync(stale)).toBe(false);
      expect(existsSync(join(directory, `sess_${store.getId()}`))).toBe(true);
    });

    it('treats a corrupt payload as a missing session', () => {
      const id = 'c'.repeat(40);
      writeFileSync(join(directory, `sess_${id}`), '{not json', 'utf-8');

      const store = new FileSessionStore({ driver: 'file', path: directory, lifetime: 120 }, id);
      store.start();

      expect(store.get('anything')).toBeUndefined();
    });

    it('invalidate() unlinks the stored file', () => {
      const store = new FileSessionStore({ driver: 'file', path: directory, lifetime: 120 });
      store.start();
      store.put('greeting', 'hello');
      store.save();
      const file = join(directory, `sess_${store.getId()}`);

      store.invalidate();

      expect(existsSync(file)).toBe(false);
    });
  });

  describe('cookie driver', () => {
    function cookieStore(key = 'test-key'): CookieSessionStore {
      return new CookieSessionStore({ driver: 'cookie', lifetime: 120, key });
    }

    it('carries a signed payload', () => {
      const store = cookieStore();
      store.start();
      store.put('greeting', 'hello');
      store.save();

      expect(store.getCookieValue()).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    });

    it('rejects tampered payloads', () => {
      const store = cookieStore();
      store.start();
      store.put('greeting', 'hello');
      store.save();
      const [encoded, signature] = store.getCookieValue().split('.');

      // Reuse the real signature over an edited payload: the HMAC changes
      const forged = `${encoded}QQ.${signature}`;

      const next = cookieStore();
      next.loadRawPayload(forged);
      next.start();

      expect(next.get('greeting')).toBeUndefined();
    });

    it('rejects payloads signed with a different key', () => {
      const store = cookieStore('key-one');
      store.start();
      store.put('greeting', 'hello');
      store.save();

      const next = cookieStore('key-two');
      next.loadRawPayload(store.getCookieValue());
      next.start();

      expect(next.get('greeting')).toBeUndefined();
    });

    it('rejects malformed and unsigned payloads', () => {
      const store = cookieStore();

      store.loadRawPayload('garbage');
      store.loadRawPayload('a.b.c');
      store.loadRawPayload('');
      store.loadRawPayload('nodothere');
      store.start();

      expect(store.get('anything')).toBeUndefined();
    });

    it('drops payloads that outlived the lifetime', () => {
      vi.useFakeTimers({ now: new Date() });

      const store = cookieStore();
      store.start();
      store.put('greeting', 'hello');
      store.save();
      const payload = store.getCookieValue();

      vi.setSystemTime(new Date(Date.now() + 121 * 60 * 1000));

      const next = cookieStore();
      next.loadRawPayload(payload);
      next.start();

      expect(next.get('greeting')).toBeUndefined();
    });

    it('stores nothing server-side and ages flash data inside the cookie', () => {
      const store = cookieStore();
      store.start();
      store.flash('status', 'Created');
      store.save();

      expect(readdirSync(directory)).toEqual([]);

      const next = cookieStore();
      next.loadRawPayload(store.getCookieValue());
      next.start();
      expect(next.get('status')).toBe('Created');
      next.save();

      const later = cookieStore();
      later.loadRawPayload(next.getCookieValue());
      later.start();
      expect(later.get('status')).toBeUndefined();
    });

    it('requires an application key for signing', () => {
      const store = new CookieSessionStore({ driver: 'cookie', lifetime: 120 });
      store.start();

      expect(() => store.getCookieValue()).toThrow(/encryption key/i);
    });
  });
});
