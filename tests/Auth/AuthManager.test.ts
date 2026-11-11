/**
 * AuthManager - guard/provider construction from auth.* config, custom
 * guard drivers (OCP), default-guard forwarding and per-request scoping.
 */

import { createRawRequest } from '@tests/Session/support';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Authenticatable } from '@/Auth/Contracts/Authenticatable';
import type { AuthManagerDependencies, StatefulGuard } from '@/Auth/index';
import { AUTH_DEFAULTS, AuthManager } from '@/Auth/AuthManager';
import { EnsembleUserProvider } from '@/Auth/EnsembleUserProvider';
import { SessionGuard } from '@/Auth/SessionGuard';
import { TokenGuard } from '@/Auth/TokenGuard';
import { Request } from '@/Routing/Request';
import { SessionManager } from '@/Session/SessionManager';
import { ArraySessionStore } from '@/Session/Stores/ArraySessionStore';
import { MemoryUser, MemoryUserModel, testHasher } from './support';

/** Minimal stateful guard used to exercise Auth.extend() */
class FixedGuard implements StatefulGuard {
  public loginCalls = 0;

  async user<T extends Authenticatable = Authenticatable>(): Promise<T | null> {
    return (MemoryUser.rows.get('1') ?? null) as unknown as T | null;
  }

  async id(): Promise<any> {
    const user = await this.user();
    return user ? user.getAuthIdentifier() : null;
  }

  async check(): Promise<boolean> {
    return (await this.user()) !== null;
  }

  async guest(): Promise<boolean> {
    return !(await this.check());
  }

  async validate(): Promise<boolean> {
    return true;
  }

  async attempt(): Promise<boolean> {
    this.loginCalls++;
    return true;
  }

  async login(): Promise<void> {
    this.loginCalls++;
  }

  async loginUsingId(): Promise<Authenticatable> {
    return this.user() as Promise<Authenticatable>;
  }

  async logout(): Promise<void> {
    // nothing stateful to clear
  }

  viaRemember(): boolean {
    return false;
  }
}

function buildManager(overrides: Record<string, any> = {}, deps: AuthManagerDependencies = {}): AuthManager {
  return new AuthManager(
    {
      providers: { users: { driver: 'ensemble', model: MemoryUserModel } },
      ...overrides,
    },
    {
      session: () => new SessionManager({ driver: 'array' }).current(),
      hash: () => testHasher(),
      ...deps,
    }
  );
}

describe('AuthManager', () => {
  beforeEach(() => {
    MemoryUser.reset();
    ArraySessionStore.clear();
  });

  describe('configuration', () => {
    it('ships the Laravel-shaped defaults', () => {
      expect(AUTH_DEFAULTS.defaults.guard).toBe('session');
      expect(AUTH_DEFAULTS.guards.session).toEqual({ driver: 'session', provider: 'users' });
      expect(AUTH_DEFAULTS.guards.token.driver).toBe('token');
      expect(AUTH_DEFAULTS.providers.users).toEqual({ driver: 'ensemble' });
    });

    it('merges app config over the defaults, keeping entries whole', () => {
      const manager = buildManager({
        defaults: { guard: 'token' },
        guards: { token: { hash: true } },
      });

      expect(manager.config.defaults.guard).toBe('token');
      // guard entries extend the defaults rather than replacing them
      expect(manager.config.guards.token).toEqual({ driver: 'token', provider: 'users', hash: true });
      expect(manager.config.guards.session.driver).toBe('session');
      expect(manager.getDefaultDriver()).toBe('token');
    });

    it('reads auth.passwords entries for the later reset ticket', () => {
      const manager = buildManager({
        passwords: { users: { provider: 'users', table: 'password_reset_tokens', expire: 60, throttle: 60 } },
      });

      expect(manager.config.passwords?.users?.table).toBe('password_reset_tokens');
      expect(manager.config.passwords?.users?.expire).toBe(60);
    });
  });

  describe('guard()', () => {
    it('builds the built-in session and token drivers', () => {
      const manager = buildManager();

      expect(manager.guard()).toBeInstanceOf(SessionGuard);
      expect(manager.guard('session')).toBe(manager.guard('session'));
      expect(manager.guard('token')).toBeInstanceOf(TokenGuard);
    });

    it('throws for unconfigured guards and drivers', () => {
      const manager = buildManager();

      expect(() => manager.guard('nope')).toThrow(
        /Auth guard \[nope\] is not defined\. Available guards: session, token\./
      );
      expect(() => buildManager({ guards: { odd: { driver: 'oauth' } } }).guard('odd')).toThrow(
        /Auth guard driver \[oauth\] is not defined/
      );
    });

    it('routes guards to their configured provider', () => {
      const manager = buildManager({
        guards: { staff: { driver: 'session', provider: 'users' } },
      });

      const guard = manager.guard('staff') as SessionGuard;
      expect(guard.getProvider()).toBeInstanceOf(EnsembleUserProvider);
      // providers are cached by name
      expect(manager.guard('staff')).not.toBe(manager.guard('session'));
    });

    it('errors when a guard references an unknown provider', () => {
      const manager = buildManager({ guards: { ghost: { driver: 'session', provider: 'missing' } } });

      expect(() => manager.guard('ghost')).toThrow(/Auth provider \[missing\] is not defined/);
    });

    it('errors when session guards are built without a session resolver', () => {
      const manager = new AuthManager({ providers: { users: { driver: 'ensemble', model: MemoryUserModel } } });

      expect(() => manager.guard('session')).toThrow(/needs a session resolver/);
    });
  });

  describe('extend()', () => {
    it('registers custom guard drivers without touching the manager (OCP, AC)', () => {
      const manager = buildManager();
      const created: string[] = [];

      manager.config.guards.custom = { driver: 'fixed', provider: 'users' };
      manager.extend('fixed', (name, config, auth) => {
        created.push(`${name}:${config.provider}`);
        expect(auth).toBe(manager);
        return new FixedGuard();
      });

      const guard = manager.guard('custom');

      expect(guard).toBeInstanceOf(FixedGuard);
      expect(created).toEqual(['custom:users']);
      // custom guards are cached per name too
      expect(manager.guard('custom')).toBe(guard);
    });

    it('custom drivers take precedence over built-ins of the same name', () => {
      const manager = buildManager();

      manager.extend('session', () => new FixedGuard());

      expect(manager.guard('session')).toBeInstanceOf(FixedGuard);
    });
  });

  describe('default-guard forwarding', () => {
    it('forwards attempt/user/check/logout like Laravel __call', async () => {
      const sessions = new SessionManager({ driver: 'array' });
      const store = sessions.store();
      store.start();
      sessions.setCurrent(store);

      const manager = buildManager({}, { session: () => sessions.current() });

      await MemoryUser.create({ email: 'ada@example.com', password: testHasher().make('secret') });

      expect(await manager.guest()).toBe(true);
      expect(await manager.attempt({ email: 'ada@example.com', password: 'secret' })).toBe(true);
      expect(await manager.check()).toBe(true);
      expect((await manager.user<MemoryUser>())!.getAttribute('email')).toBe('ada@example.com');
      expect(await manager.id()).toBe(1);
      expect(await manager.validate({ email: 'ada@example.com' })).toBe(true);
      expect(manager.viaRemember()).toBe(false);

      await manager.logout();
      expect(await manager.guest()).toBe(true);
    });

    it('honours a different default guard', async () => {
      const manager = buildManager({
        defaults: { guard: 'token' },
      });

      const guard = manager.guard();
      expect(guard).toBeInstanceOf(TokenGuard);
      await expect(guard.attempt({})).rejects.toThrow(/stateless/);
    });
  });

  describe('forRequest()', () => {
    it('scopes guards to the request and wires Request.user()/auth()', async () => {
      const sessions = new SessionManager({ driver: 'array' });
      const store = sessions.store();
      store.start();
      sessions.setCurrent(store);

      const manager = buildManager({}, { session: () => sessions.current() });
      const request = new Request(createRawRequest('GET', '/dashboard'));

      await MemoryUser.create({ email: 'ada@example.com', password: testHasher().make('secret') });

      manager.forRequest(request);

      expect(manager.guard()).toBeInstanceOf(SessionGuard);
      expect(await request.user()).toBeNull();

      const authed = await manager.attempt({ email: 'ada@example.com', password: 'secret' });
      expect(authed).toBe(true);

      const user = await request.user<MemoryUser>();
      expect(user!.getAttribute('email')).toBe('ada@example.com');
      expect(request.auth()).toBe(manager.guard());
      expect(request.auth('session')).toBe(manager.guard('session'));

      // A fresh request scope builds clean guard instances
      const firstGuard = request.auth();
      const second = new Request(createRawRequest('GET', '/dashboard'));
      manager.forRequest(second);
      expect(second.auth()).not.toBe(firstGuard);
      // ...and the session still carries the login, so the user carries over
      expect(await second.user()).not.toBeNull();
    });

    it('reports missing bindings helpfully', () => {
      const manager = buildManager();
      const request = new Request(createRawRequest('GET', '/'));

      expect(() => request.auth()).toThrow(/No auth guard bound to this request/);
    });

    it('currentRequest tracks the bound request', () => {
      const manager = buildManager();
      const request = new Request(createRawRequest('GET', '/'));

      expect(manager.currentRequest()).toBeNull();
      manager.forRequest(request);
      expect(manager.currentRequest()).toBe(request);
    });
  });
});
