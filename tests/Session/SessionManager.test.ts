import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_DEFAULTS, SessionManager } from '@/Session/SessionManager';
import { ArraySessionStore } from '@/Session/Stores/ArraySessionStore';
import { BaseSessionStore } from '@/Session/Stores/BaseSessionStore';
import { CookieSessionStore } from '@/Session/Stores/CookieSessionStore';
import { FileSessionStore } from '@/Session/Stores/FileSessionStore';

const VALID_ID = 'a'.repeat(40);

class RecordingStore extends BaseSessionStore {
  static readonly reads: string[] = [];

  protected read(): Record<string, any> | null {
    RecordingStore.reads.push(this.getId());

    return null;
  }

  protected write(): void {
    // Custom drivers decide their own persistence
  }
}

describe('SessionManager', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'orchestr-sessions-'));
    ArraySessionStore.clear();
    RecordingStore.reads.length = 0;
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  describe('driver resolution', () => {
    it('builds the configured default driver', () => {
      const manager = new SessionManager({ driver: 'file', files: directory });

      expect(manager.store()).toBeInstanceOf(FileSessionStore);
      expect(manager.getDefaultDriver()).toBe('file');
    });

    it('builds array and cookie stores by name', () => {
      const manager = new SessionManager({ driver: 'array' });

      expect(manager.store('array')).toBeInstanceOf(ArraySessionStore);
      expect(manager.store('cookie')).toBeInstanceOf(CookieSessionStore);
    });

    it('gives every request a distinct store instance', () => {
      const manager = new SessionManager({ driver: 'array' });

      expect(manager.store()).not.toBe(manager.store());
    });

    it('throws for unconfigured stores and unknown drivers', () => {
      const manager = new SessionManager({ driver: 'array' });

      expect(() => manager.store('missing')).toThrow(/Session store \[missing\] not configured/);

      const broken = new SessionManager({ stores: { exotic: { driver: 'exotic' } } });
      expect(() => broken.store('exotic')).toThrow(/Session driver \[exotic\] not registered/);
    });

    it('accepts new drivers through extend() without touching the manager (OCP)', () => {
      const manager = new SessionManager({ driver: 'recording', stores: { recording: { driver: 'recording' } } });
      manager.extend('recording', (config, id) => new RecordingStore(config, id));

      const store = manager.store();
      store.start();

      expect(store.getId()).toMatch(/^[a-zA-Z0-9]{40}$/);
      expect(RecordingStore.reads).toEqual([store.getId()]);
    });

    it('passes signing and lifetime config down to file and cookie stores', () => {
      const manager = new SessionManager({ files: directory, key: 'app-key', lifetime: 5 });

      const file = manager.store('file') as FileSessionStore;
      const cookie = manager.store('cookie') as CookieSessionStore;
      file.start();
      cookie.start();

      file.put('x', 1);
      file.save();
      cookie.put('x', 1);

      // The file lands in the configured directory; the cookie payload
      // signs with the app key and round-trips
      expect(existsSync(join(directory, `sess_${file.getId()}`))).toBe(true);

      const next = manager.store('cookie') as CookieSessionStore;
      next.loadRawPayload(cookie.getCookieValue());
      next.start();

      expect(next.get('x')).toBe(1);
    });
  });

  describe('session IDs from cookies', () => {
    it('adopts a well-formed cookie ID', () => {
      const manager = new SessionManager({ driver: 'array' });

      const store = manager.store(undefined, VALID_ID);
      store.start();

      expect(store.getId()).toBe(VALID_ID);
    });

    it('replaces malformed cookie IDs with a fresh random one', () => {
      const manager = new SessionManager({ driver: 'array' });

      for (const hostile of ['../../etc/passwd', 'short', ''.padEnd(39, 'a'), `${'a'.repeat(39)}!`]) {
        const store = manager.store(undefined, hostile || null);
        store.start();

        expect(store.getId()).toMatch(/^[a-zA-Z0-9]{40}$/);
        expect(store.getId()).not.toBe(hostile);
      }
    });

    it('generates random IDs without a cookie', () => {
      const manager = new SessionManager({ driver: 'array' });

      const one = manager.store();
      const two = manager.store();

      expect(one.getId()).not.toBe(two.getId());
    });
  });

  describe('current session tracking', () => {
    it('tracks the session bound for the current request', () => {
      const manager = new SessionManager({ driver: 'array' });

      expect(manager.current()).toBeNull();

      const store = manager.store();
      manager.setCurrent(store);

      expect(manager.current()).toBe(store);

      manager.forgetCurrent();
      expect(manager.current()).toBeNull();
    });
  });

  describe('cookie configuration', () => {
    it('exposes the documented secure defaults', () => {
      const manager = new SessionManager();

      expect(manager.getCookieName()).toBe(SESSION_DEFAULTS.cookie);
      expect(manager.getCookieOptions()).toMatchObject({
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
        maxAge: 120 * 60,
      });
    });

    it('honours configured name, lifetime, path and domain', () => {
      const manager = new SessionManager({
        cookie: 'my_app_session',
        lifetime: 30,
        path: '/admin',
        domain: 'example.com',
        secure: true,
      });

      expect(manager.getCookieName()).toBe('my_app_session');
      expect(manager.getCookieOptions()).toMatchObject({
        maxAge: 30 * 60,
        path: '/admin',
        domain: 'example.com',
        secure: true,
      });
    });

    it('omits cookie expiry when the session should expire on close', () => {
      const manager = new SessionManager({ expire_on_close: true });
      const options = manager.getCookieOptions();

      expect(options.maxAge).toBeUndefined();
      expect(options.expires).toBeUndefined();
    });
  });
});
