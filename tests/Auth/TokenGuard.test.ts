/**
 * TokenGuard - bearer token authentication via the Authorization header
 * or a configurable input key, with plain and hashed token columns.
 */

import { createRawRequest } from '@tests/Session/support';
import { createHash } from 'crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { EnsembleUserProvider } from '@/Auth/EnsembleUserProvider';
import { TokenGuard } from '@/Auth/TokenGuard';
import { Request } from '@/Routing/Request';
import { MemoryUser, testHasher } from './support';

function buildProvider(): EnsembleUserProvider {
  return new EnsembleUserProvider({ model: MemoryUser as any, credentials: ['api_token'] }, testHasher());
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

describe('TokenGuard', () => {
  beforeEach(() => {
    MemoryUser.reset();
    MemoryUser.seed({
      email: 'ada@example.com',
      password: testHasher().make('secret'),
      api_token: 'plain-token-abc',
    });
    MemoryUser.seed({
      email: 'grace@example.com',
      api_token: sha256('hashed-token-xyz'),
    });
  });

  describe('bearer header', () => {
    it('authenticates Authorization: Bearer <token> (AC)', async () => {
      const request = new Request(
        createRawRequest('GET', '/api/me', { headers: { authorization: 'Bearer plain-token-abc' } })
      );
      const guard = new TokenGuard('token', buildProvider(), {}, request);

      expect(request.bearerToken()).toBe('plain-token-abc');
      expect(await guard.check()).toBe(true);

      const user = await guard.user<MemoryUser>();
      expect(user!.getAttribute('email')).toBe('ada@example.com');
      expect(await guard.id()).toBe(user!.getAuthIdentifier());
    });

    it('rejects unknown or missing tokens', async () => {
      const unknown = new TokenGuard(
        'token',
        buildProvider(),
        {},
        new Request(createRawRequest('GET', '/api/me', { headers: { authorization: 'Bearer nope' } }))
      );

      expect(await unknown.user()).toBeNull();
      expect(await unknown.guest()).toBe(true);
      expect(await unknown.id()).toBeNull();

      const bare = new TokenGuard('token', buildProvider(), {}, new Request(createRawRequest('GET', '/api/me')));
      expect(await bare.user()).toBeNull();
    });

    it('memoises the user across calls on the same guard', async () => {
      const guard = new TokenGuard(
        'token',
        buildProvider(),
        {},
        new Request(createRawRequest('GET', '/api/me', { headers: { authorization: 'Bearer plain-token-abc' } }))
      );

      expect(await guard.user()).toBe(await guard.user());

      await guard.logout();

      // logout only forgets the memoised identity; the token still works
      expect(await guard.user()).not.toBeNull();
    });
  });

  describe('configurable input key', () => {
    it('falls back to the configured query/input key', async () => {
      const guard = new TokenGuard(
        'token',
        buildProvider(),
        { input: 'key' },
        new Request(createRawRequest('GET', '/api/me?key=plain-token-abc'))
      );

      expect(guard.token()).toBe('plain-token-abc');
      expect(await guard.check()).toBe(true);
    });

    it('defaults to api_token for input', async () => {
      const guard = new TokenGuard(
        'token',
        buildProvider(),
        {},
        new Request(createRawRequest('GET', '/api/me?api_token=plain-token-abc'))
      );

      expect(await guard.user()).not.toBeNull();
    });

    it('honours a configurable token column', async () => {
      MemoryUser.seed({ email: 'ada@example.com', token: 'column-token' });

      const provider = new EnsembleUserProvider({ model: MemoryUser as any, credentials: ['token'] }, testHasher());
      const guard = new TokenGuard(
        'token',
        provider,
        { token: 'token' },
        new Request(createRawRequest('GET', '/api/me', { headers: { authorization: 'Bearer column-token' } }))
      );

      expect((await guard.user<MemoryUser>())!.getAttribute('email')).toBe('ada@example.com');
    });
  });

  describe('hashed tokens', () => {
    it('compares the SHA-256 digest of the bearer token when hash is enabled', async () => {
      const guard = new TokenGuard(
        'token',
        buildProvider(),
        { hash: true },
        new Request(createRawRequest('GET', '/api/me', { headers: { authorization: 'Bearer hashed-token-xyz' } }))
      );

      const user = await guard.user<MemoryUser>();
      expect(user!.getAttribute('email')).toBe('grace@example.com');
      expect(guard.digest('hashed-token-xyz')).toBe(sha256('hashed-token-xyz'));
    });

    it('does not find plaintext-stored rows when hashing', async () => {
      const guard = new TokenGuard(
        'token',
        buildProvider(),
        { hash: true },
        new Request(createRawRequest('GET', '/api/me', { headers: { authorization: 'Bearer plain-token-abc' } }))
      );

      expect(await guard.user()).toBeNull();
    });

    it('validate() digests the submitted token for hashed guards', async () => {
      const guard = new TokenGuard('token', buildProvider(), { hash: true });

      expect(await guard.validate({ api_token: 'hashed-token-xyz' })).toBe(true);
      expect(await guard.validate({ api_token: 'unknown' })).toBe(false);
    });
  });

  describe('stateless limits', () => {
    it('does not support login flows or remember me', async () => {
      const guard = new TokenGuard(
        'token',
        buildProvider(),
        {},
        new Request(createRawRequest('GET', '/api/me', { headers: { authorization: 'Bearer plain-token-abc' } }))
      );

      expect(guard.viaRemember()).toBe(false);
      await expect(guard.attempt({ email: 'ada@example.com', password: 'secret' })).rejects.toThrow(
        /does not support \[attempt\]/
      );
      await expect(guard.login(MemoryUser.rows.get('1')!)).rejects.toThrow(/does not support \[login\]/);
      await expect(guard.loginUsingId(1)).rejects.toThrow(/does not support \[loginUsingId\]/);
    });

    it('re-resolves the user after setRequest swaps the request', async () => {
      const first = new Request(
        createRawRequest('GET', '/api/me', { headers: { authorization: 'Bearer plain-token-abc' } })
      );
      const guard = new TokenGuard('token', buildProvider(), {}, first);

      expect((await guard.user<MemoryUser>())!.getAttribute('email')).toBe('ada@example.com');

      guard.setRequest(
        new Request(createRawRequest('GET', '/api/me', { headers: { authorization: 'Bearer hashed-token-xyz' } }))
      );

      // Plain (unhashed) lookup: the digest column value is not the raw token
      expect(await guard.user()).toBeNull();
    });
  });
});
