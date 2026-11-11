/**
 * Encryption - the AES-256-GCM Encrypter, the Crypt facade and helpers
 */

import { randomBytes } from 'crypto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DecryptException } from '@/Encryption/DecryptException';
import { Encrypter } from '@/Encryption/Encrypter';
import { EncryptionServiceProvider } from '@/Encryption/EncryptionServiceProvider';
import { MissingAppKeyException } from '@/Encryption/MissingAppKeyException';
import { Crypt } from '@/Facades/Crypt';
import { Application } from '@/Foundation/Application';
import { Config } from '@/Foundation/Config/Config';
import { Facade } from '@/Support/Facade';
import { decrypt, encrypt } from '@/Support/helpers';

/** A valid raw 32-byte key as base64, the Laravel way */
function base64Key(): string {
  return 'base64:' + randomBytes(32).toString('base64');
}

/** A raw 32-character key consumed as UTF-8 bytes */
function rawKey(): string {
  return '0123456789abcdef0123456789ABCDEF';
}

describe('Encrypter', () => {
  it('round-trips structured values through the serialisation layer (AC)', () => {
    const crypt = new Encrypter(rawKey());

    const payload = crypt.encrypt({ a: 1 });

    expect(typeof payload).toBe('string');
    expect(crypt.decrypt(payload)).toEqual({ a: 1 });
    expect(crypt.decrypt(crypt.encrypt('string-value'))).toBe('string-value');
    expect(crypt.decrypt(crypt.encrypt([1, 'two', null]))).toEqual([1, 'two', null]);
    expect(crypt.decrypt(crypt.encrypt(null))).toBeNull();
  });

  it('never leaks the plaintext into the payload', () => {
    const crypt = new Encrypter(rawKey());

    const payload = crypt.encrypt({ secret: 'hunter2' });

    expect(payload).not.toContain('hunter2');
    expect(Buffer.from(payload, 'base64').toString('utf8')).not.toMatch(/hunter2/);
  });

  it('builds an authenticated payload carrying iv, value and tag', () => {
    const crypt = new Encrypter(rawKey());

    const payload = JSON.parse(Buffer.from(crypt.encrypt('hi'), 'base64').toString('utf8'));

    expect(typeof payload.iv).toBe('string');
    expect(typeof payload.value).toBe('string');
    expect(typeof payload.tag).toBe('string');
    expect(Buffer.from(payload.iv, 'base64')).toHaveLength(12);
    expect(Buffer.from(payload.tag, 'base64')).toHaveLength(16);
  });

  it('produces a fresh payload each call (random IV)', () => {
    const crypt = new Encrypter(rawKey());

    expect(crypt.encrypt('same')).not.toBe(crypt.encrypt('same'));
  });

  it('rejects tampered payloads with a clear DecryptException (AC)', () => {
    const crypt = new Encrypter(rawKey());
    const payload = crypt.encrypt({ a: 1 });

    const flipped = Buffer.from(payload, 'base64');
    const decoded = JSON.parse(flipped.toString('utf8'));
    const value = Buffer.from(decoded.value, 'base64');
    value[0] ^= 0xff;
    decoded.value = value.toString('base64');
    const tampered = Buffer.from(JSON.stringify(decoded)).toString('base64');

    expect(() => crypt.decrypt(tampered)).toThrow(DecryptException);
    expect(() => crypt.decrypt(tampered)).toThrow(/payload is invalid/i);

    // A mutated tag authenticates just as badly
    const tagDecoded = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
    const tag = Buffer.from(tagDecoded.tag, 'base64');
    tag[0] ^= 0xff;
    tagDecoded.tag = tag.toString('base64');
    const retagged = Buffer.from(JSON.stringify(tagDecoded)).toString('base64');

    expect(() => crypt.decrypt(retagged)).toThrow(DecryptException);

    // Foreign noise too
    expect(() => crypt.decrypt('this is not a payload')).toThrow(DecryptException);
    expect(() => crypt.decrypt('')).toThrow(DecryptException);
  });

  it('rejects payloads encrypted under a different key', () => {
    const a = new Encrypter(rawKey());
    const b = new Encrypter('9876543210fedcba9876543210FEDCBA');

    const payload = a.encrypt('top secret');

    expect(() => b.decrypt(payload)).toThrow(DecryptException);
  });

  it('encrypts and decrypts plain strings without the serialisation layer', () => {
    const crypt = new Encrypter(rawKey());

    expect(crypt.decryptString(crypt.encryptString('hello world'))).toBe('hello world');
    expect(crypt.decrypt(crypt.encryptString('raw'), false)).toBe('raw');
    expect(() => crypt.encryptString(42 as unknown as string)).toThrow(TypeError);
  });

  it('refuses non-strings when serialisation is off', () => {
    const crypt = new Encrypter(rawKey());

    expect(() => crypt.encrypt({ a: 1 }, false)).toThrow(TypeError);
  });

  it('fails fast on an invalid key length', () => {
    expect(() => new Encrypter('too-short')).toThrow(/incorrect key length/i);
    expect(() => new Encrypter('too-short')).toThrow(/32/);
    expect(() => new Encrypter('x'.repeat(31))).toThrow(/incorrect key length/i);
    expect(() => new Encrypter('x'.repeat(33))).toThrow(/incorrect key length/i);
    expect(() => new Encrypter(Buffer.alloc(24))).toThrow(/incorrect key length/i);
    expect(() => new Encrypter('')).toThrow(MissingAppKeyException);
    expect(() => new Encrypter('')).toThrow(/No application encryption key has been specified/);
  });

  it('accepts base64: keys, plain base64 keys and raw Buffers', () => {
    const bytes = randomBytes(32);

    const prefixed = new Encrypter('base64:' + bytes.toString('base64'));
    const plain = new Encrypter(bytes.toString('base64'));
    const buffer = new Encrypter(Buffer.from(bytes));

    const payload = prefixed.encrypt({ key: 'shared' });

    expect(plain.decrypt(payload)).toEqual({ key: 'shared' });
    expect(buffer.decrypt(payload)).toEqual({ key: 'shared' });
    expect(plain.getKey().toString('hex')).toBe(bytes.toString('hex'));
  });

  it('rejects unsupported ciphers', () => {
    expect(() => new Encrypter(rawKey(), 'AES-128-CBC' as never)).toThrow(/cipher is not supported/i);
  });
});

describe('EncryptionServiceProvider + facade + helper', () => {
  let app: Application;

  beforeEach(async () => {
    app = new Application('/test');
    app.instance('config', new Config({ app: { key: base64Key() } }));
    app.register(EncryptionServiceProvider);
    await app.boot();
    Facade.setFacadeApplication(app);
    Facade.clearResolvedInstances();
  });

  afterEach(() => {
    Facade.setFacadeApplication(undefined as unknown as Application);
    Facade.clearResolvedInstances();
  });

  it('round-trips through the Crypt facade (AC)', () => {
    expect(app.bound('encrypter')).toBe(true);

    const payload = Crypt.encrypt({ a: 1 });

    expect(Crypt.decrypt(payload)).toEqual({ a: 1 });
  });

  it('round-trips through the encrypt()/decrypt() helpers', () => {
    const payload = encrypt({ nested: { list: [1, 2, 3] } });

    expect(decrypt(payload)).toEqual({ nested: { list: [1, 2, 3] } });
    expect(decrypt(encrypt('plain string'))).toBe('plain string');
  });

  it('falls back to the APP_KEY environment variable', () => {
    const envApp = new Application('/test-env');
    process.env.APP_KEY = base64Key();

    try {
      envApp.register(EncryptionServiceProvider);

      const crypt = envApp.make<Encrypter>('encrypter');

      expect(crypt.decrypt(crypt.encrypt({ via: 'env' }))).toEqual({ via: 'env' });
    } finally {
      delete process.env.APP_KEY;
    }
  });

  it('fails fast when no key is configured anywhere', () => {
    const key = process.env.APP_KEY;
    delete process.env.APP_KEY;

    try {
      const bare = new Application('/test-nokey');
      bare.register(EncryptionServiceProvider);

      expect(() => bare.make('encrypter')).toThrow(MissingAppKeyException);
    } finally {
      if (key !== undefined) {
        process.env.APP_KEY = key;
      }
    }
  });
});
