/**
 * EnsembleUserProvider - credential lookup, password verification and
 * remember-token persistence driven by the provider's model configuration.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { EnsembleUserProvider } from '@/Auth/EnsembleUserProvider';
import { HashManager } from '@/Hashing/HashManager';
import { MemoryUser, testHasher, TEST_OPTIONS } from './support';

function provider(config: Record<string, any> = {}, hasher: HashManager = testHasher()): EnsembleUserProvider {
  return new EnsembleUserProvider({ model: MemoryUser as any, ...config }, hasher);
}

describe('EnsembleUserProvider', () => {
  beforeEach(() => {
    MemoryUser.reset();
  });

  describe('configuration', () => {
    it('rejects a provider without a model', () => {
      expect(() => new EnsembleUserProvider({}, testHasher())).toThrow(/has no model configured/);
    });
  });

  describe('retrieveByCredentials', () => {
    beforeEach(() => {
      MemoryUser.seed({ email: 'ada@example.com', password: 'secret-hash' });
    });

    it('looks users up by the non-password credential columns (AC: attempt columns)', async () => {
      const found = await provider().retrieveByCredentials({ email: 'ada@example.com', password: 'secret' });

      expect(found).not.toBeNull();
      expect(found!.getAuthIdentifier()).toBe(1);
    });

    it('returns null for unknown credentials', async () => {
      expect(await provider().retrieveByCredentials({ email: 'grace@example.com', password: 'secret' })).toBeNull();
    });

    it('never treats the password column as a lookup column', async () => {
      const only = await provider().retrieveByCredentials({ password: 'secret-hash' });

      // Password-only credentials must not collapse into "first row"
      expect(only).toBeNull();
    });

    it('skips keys containing "password" like Laravel does', async () => {
      const found = await provider().retrieveByCredentials({
        email: 'ada@example.com',
        password: 'secret',
        password_confirmation: 'secret',
      });

      expect(found).not.toBeNull();
    });

    it('restricts lookups to the configured credential columns', async () => {
      MemoryUser.seed({ username: 'ada', email: 'ada@example.com', password: 'hash' });

      const names = provider({ credentials: ['username'] });

      expect(await names.retrieveByCredentials({ username: 'ada', password: 'secret' })).not.toBeNull();
      // email is not a configured credential column, so it cannot identify a user
      expect(await names.retrieveByCredentials({ email: 'ada@example.com', password: 'secret' })).toBeNull();
    });

    it('honours a custom password column name', async () => {
      MemoryUser.seed({ email: 'ada@example.com', passphrase: 'plain' });

      const custom = provider({ password: 'passphrase' });
      const found = await custom.retrieveByCredentials({ email: 'ada@example.com', passphrase: 'plain' });

      expect(found).not.toBeNull();
    });
  });

  describe('validateCredentials', () => {
    it('checks the plaintext password against the stored hash', async () => {
      const user = await MemoryUser.create({ email: 'ada@example.com', password: testHasher().make('secret') });

      expect(await provider().validateCredentials(user, { email: 'ada@example.com', password: 'secret' })).toBe(true);
      expect(await provider().validateCredentials(user, { email: 'ada@example.com', password: 'wrong' })).toBe(false);
    });

    it('fails cleanly when either side of the password is missing', async () => {
      const user = await MemoryUser.create({ email: 'ada@example.com' });

      expect(await provider().validateCredentials(user, {})).toBe(false);
      expect(await provider().validateCredentials(user, { password: 'secret' })).toBe(false);
    });

    it('rehashes stale hashes on the fly and persists them (Laravel rehasher)', async () => {
      const oldHasher = new HashManager({
        driver: 'scrypt',
        scrypt: { ...TEST_OPTIONS, cost: 2048 },
      });
      const user = await MemoryUser.create({ email: 'ada@example.com', password: oldHasher.make('secret') });

      const current = provider();
      const savedBefore = user.savedTimes;

      expect(await current.validateCredentials(user, { email: 'ada@example.com', password: 'secret' })).toBe(true);

      // The stored hash now verifies with the current options and was saved
      expect(current.getHasher().check('secret', user.getAuthPassword()!)).toBe(true);
      expect(current.getHasher().needsRehash(user.getAuthPassword()!)).toBe(false);
      expect(user.savedTimes).toBe(savedBefore + 1);
      expect(MemoryUser.rows.get(String(user.getAuthIdentifier()))!.getAuthPassword()).toBe(user.getAuthPassword());
    });

    it('leaves stale hashes alone when rehash is disabled', async () => {
      const oldHasher = new HashManager({ driver: 'scrypt', scrypt: { ...TEST_OPTIONS, cost: 2048 } });
      const stored = oldHasher.make('secret');
      const user = await MemoryUser.create({ email: 'ada@example.com', password: stored });

      const noRehash = provider({ rehash: false });

      expect(await noRehash.validateCredentials(user, { password: 'secret' })).toBe(true);
      expect(user.getAuthPassword()).toBe(stored);
      expect(user.savedTimes).toBe(1);
    });
  });

  describe('remember tokens', () => {
    it('retrieves a user by identifier and token pair', async () => {
      const user = await MemoryUser.create({ email: 'ada@example.com', remember_token: 'token-123' });

      expect(await provider().retrieveByToken(user.getAuthIdentifier(), 'token-123')).toBe(user);
      expect(await provider().retrieveByToken(user.getAuthIdentifier(), 'wrong-token')).toBeNull();
      expect(await provider().retrieveByToken(999, 'token-123')).toBeNull();
    });

    it('persists a new remember token without touching timestamps', async () => {
      const user = await MemoryUser.create({ email: 'ada@example.com' });
      const timestampsAtSave = { current: true };

      const observed = user.save.bind(user);
      user.save = async () => {
        timestampsAtSave.current = user.timestamps;
        return observed();
      };

      await provider().updateRememberToken(user, 'fresh-token');

      expect(user.getRememberToken()).toBe('fresh-token');
      // Laravel suspends timestamps for the remember-token write
      expect(timestampsAtSave.current).toBe(false);
      expect(user.timestamps).toBe(true);
      expect(MemoryUser.rows.get(String(user.getAuthIdentifier()))!.getRememberToken()).toBe('fresh-token');
    });

    it('clears the remember token when set to null', async () => {
      const user = await MemoryUser.create({ email: 'ada@example.com', remember_token: 'token-123' });

      await provider().updateRememberToken(user, null);

      expect(user.getRememberToken()).toBeNull();
    });
  });

  describe('retrieveById', () => {
    it('finds users by their primary key', async () => {
      const user = await MemoryUser.create({ email: 'ada@example.com' });

      expect(await provider().retrieveById(user.getAuthIdentifier())).toBe(user);
      expect(await provider().retrieveById(404)).toBeNull();
    });
  });
});
