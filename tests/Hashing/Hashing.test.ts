/**
 * Hashing - scrypt driver, HashManager, and the Hash facade
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hash } from '@/Facades/Hash';
import { Application } from '@/Foundation/Application';
import { Config } from '@/Foundation/Config/Config';
import { ArgonHasher } from '@/Hashing/ArgonHasher';
import { BcryptHasher } from '@/Hashing/BcryptHasher';
import { HashDriverUnavailableException } from '@/Hashing/HashDriverUnavailableException';
import { HASHING_DEFAULTS, HashManager } from '@/Hashing/HashManager';
import { HashServiceProvider } from '@/Hashing/HashServiceProvider';
import { ScryptHasher } from '@/Hashing/ScryptHasher';
import { Facade } from '@/Support/Facade';
import { hash } from '@/Support/helpers';

/** Cheap-but-real scrypt settings so the suite does not crawl */
const TEST_OPTIONS = { cost: 1024, blockSize: 8, parallelization: 1, keyLength: 32, saltLength: 16 };

describe('ScryptHasher', () => {
  let hasher: ScryptHasher;

  beforeEach(() => {
    hasher = new ScryptHasher(TEST_OPTIONS);
  });

  it('makes a hash the driver itself recognises', () => {
    const hashed = hasher.make('secret');

    expect(hashed.startsWith('$scrypt$')).toBe(true);
    // $scrypt$<params>$<salt>$<digest> - four non-empty segments
    expect(hashed.split('$').filter(Boolean)).toHaveLength(4);
    expect(hashed).not.toContain('secret');
  });

  it('verifies the right value and rejects the wrong one (AC: Hash.check)', () => {
    const hashed = hasher.make('secret');

    expect(hasher.check('secret', hashed)).toBe(true);
    expect(hasher.check('secret ', hashed)).toBe(false);
    expect(hasher.check('wrong', hashed)).toBe(false);
  });

  it('produces a different hash each time (random salt)', () => {
    expect(hasher.make('secret')).not.toBe(hasher.make('secret'));
  });

  it('treats unparsable or foreign hashes as failed checks', () => {
    expect(hasher.check('secret', 'not-a-hash')).toBe(false);
    expect(hasher.check('secret', '$scrypt$garbage')).toBe(false);
    expect(hasher.check('secret', '')).toBe(false);
  });

  it('detects a cost change through needsRehash (AC)', () => {
    const hashed = hasher.make('secret');

    expect(hasher.needsRehash(hashed)).toBe(false);
    expect(hasher.needsRehash(hashed, { cost: 2048 })).toBe(true);
    expect(hasher.needsRehash(hashed, { blockSize: 16 })).toBe(true);
    expect(hasher.needsRehash(hashed, { keyLength: 64 })).toBe(true);
  });

  it('detects an algorithm change through needsRehash (AC)', () => {
    expect(hasher.needsRehash('$2b$12$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ12')).toBe(true);
    expect(hasher.needsRehash('argon2-nonsense')).toBe(true);
  });

  it('reports hash info', () => {
    const hashed = hasher.make('secret');
    const info = hasher.info(hashed);

    expect(info).not.toBeNull();
    expect(info!.algo).toBe('scrypt');
    expect(info!.options.cost).toBe(1024);
    expect(info!.salt).toBeTypeOf('string');
    expect(hasher.info('junk')).toBeNull();
  });

  it('verifyConfiguration passes for workable options and fails for junk', () => {
    expect(() => hasher.verifyConfiguration()).not.toThrow();

    const broken = new ScryptHasher({ cost: 1000 }); // not a power of two

    expect(() => broken.verifyConfiguration()).toThrow(/cannot hash with the configured options/i);
  });

  it('rejects invalid scrypt parameters at make() time', () => {
    expect(() => new ScryptHasher({ cost: 1000 }).make('secret')).toThrow(/power of two/);
    expect(() => new ScryptHasher({ blockSize: 0 }).make('secret')).toThrow(/blockSize/);
    expect(() => new ScryptHasher({ parallelization: -1 }).make('secret')).toThrow(/parallelization/);
  });
});

describe('BcryptHasher', () => {
  it('needs the optional bcrypt package and says so clearly', () => {
    const hasher = new BcryptHasher({ rounds: 10 });

    // bcrypt is not installed in this environment; the contract is a clear,
    // actionable error rather than a silent false
    expect(() => hasher.make('secret')).toThrow(HashDriverUnavailableException);
    expect(() => hasher.make('secret')).toThrow(/npm install bcrypt/);
    expect(() => hasher.check('secret', '$2b$10$' + 'x'.repeat(53))).toThrow(HashDriverUnavailableException);
  });

  it('works against an injected bcrypt module', () => {
    const fake = fakeBcrypt();
    const hasher = new BcryptHasher({ rounds: 10 }, fake);

    const hashed = hasher.make('secret');

    expect(hashed.startsWith('$2b$10$')).toBe(true);
    expect(hasher.check('secret', hashed)).toBe(true);
    expect(hasher.check('nope', hashed)).toBe(false);
    expect(hasher.needsRehash(hashed)).toBe(false);
    expect(hasher.needsRehash(hashed, { rounds: 12 })).toBe(true);
    expect(hasher.needsRehash('$scrypt$whatever')).toBe(true);

    const info = hasher.info(hashed);
    expect(info!.options.rounds).toBe(10);
  });

  it('rejects absurd round counts before touching the module', () => {
    const hasher = new BcryptHasher({ rounds: 99 }, fakeBcrypt());

    expect(() => hasher.make('secret')).toThrow(/Invalid bcrypt rounds/);
  });
});

describe('ArgonHasher', () => {
  it('needs the optional argon2 package and says so clearly', () => {
    const hasher = new ArgonHasher();

    expect(() => hasher.make('secret')).toThrow(HashDriverUnavailableException);
    expect(() => hasher.make('secret')).toThrow(/npm install argon2/);
  });

  it('works against an injected argon2 module and detects cost changes', () => {
    const fake = fakeArgon2();
    const hasher = new ArgonHasher({ memoryCost: 1024, timeCost: 2, parallelism: 1, hashLength: 16 }, fake);

    const hashed = hasher.make('secret');

    expect(hashed.startsWith('$argon2id$')).toBe(true);
    expect(hasher.check('secret', hashed)).toBe(true);
    expect(hasher.check('wrong', hashed)).toBe(false);
    expect(hasher.needsRehash(hashed)).toBe(false);
    expect(hasher.needsRehash(hashed, { memoryCost: 2048 })).toBe(true);
    expect(hasher.needsRehash(hashed, { timeCost: 3 })).toBe(true);
    expect(hasher.needsRehash('$2b$10$short', { memoryCost: 1024 })).toBe(true);

    const info = hasher.info(hashed)!;
    expect(info.algo).toBe('argon2id');
    expect(info.options.memoryCost).toBe(1024);
  });

  it('validates parameters before hashing', () => {
    const hasher = new ArgonHasher({ memoryCost: 1 }, fakeArgon2());

    expect(() => hasher.make('secret')).toThrow(/memoryCost/);
  });
});

describe('HashManager', () => {
  it('defaults to scrypt', () => {
    const manager = new HashManager({ scrypt: TEST_OPTIONS });

    expect(HASHING_DEFAULTS.driver).toBe('scrypt');
    expect(manager.getDefaultDriver()).toBe('scrypt');
    expect(manager.driver()).toBeInstanceOf(ScryptHasher);
  });

  it('round-trips through the default driver', () => {
    const manager = new HashManager({ scrypt: TEST_OPTIONS });

    const hashed = manager.make('secret');

    expect(manager.check('secret', hashed)).toBe(true);
    expect(manager.check('wrong', hashed)).toBe(false);
    expect(manager.needsRehash(hashed)).toBe(false);
    expect(manager.needsRehash(hashed, { cost: 4096 })).toBe(true);
    expect(() => manager.verifyConfiguration()).not.toThrow();
  });

  it('caches driver instances', () => {
    const manager = new HashManager({ scrypt: TEST_OPTIONS });

    expect(manager.driver()).toBe(manager.driver());
    expect(manager.driver('scrypt')).toBe(manager.driver());
  });

  it('errors on unknown drivers naming the available ones', () => {
    const manager = new HashManager();

    expect(() => manager.driver('sodium')).toThrow(/Hash driver \[sodium\] is not defined/);
    expect(() => manager.driver('sodium')).toThrow(/scrypt, bcrypt, argon2/);
  });

  it('accepts custom drivers through extend', () => {
    const manager = new HashManager();

    manager.extend('rot13', () => ({
      make: (value: string) => `rot13:${value}`,
      check: (value: string, hashed: string) => hashed === `rot13:${value}`,
      needsRehash: (hashed: string) => !hashed.startsWith('rot13:'),
      verifyConfiguration: () => undefined,
      info: () => ({ algo: 'rot13', options: {}, salt: null }),
    }));

    const rot13 = manager.driver('rot13');

    expect(rot13.make('secret')).toBe('rot13:secret');
    expect(rot13.check('secret', 'rot13:secret')).toBe(true);
    expect(rot13.needsRehash('$scrypt$N=1,r=8,p=1$c2FsdA==$ZGlnZXN0')).toBe(true);
  });

  it('passes configured driver options through', () => {
    const manager = new HashManager({ scrypt: { ...TEST_OPTIONS, cost: 2048 } });

    const hashed = manager.make('secret');

    expect(hashed).toContain('N=2048');
    expect(manager.needsRehash(hashed)).toBe(false);
    expect(manager.check('secret', hashed)).toBe(true);
  });
});

describe('HashServiceProvider + facade + helper', () => {
  let app: Application;

  beforeEach(async () => {
    app = new Application('/test');
    app.instance('config', new Config({ hashing: { driver: 'scrypt', scrypt: TEST_OPTIONS } }));
    app.register(HashServiceProvider);
    await app.boot();
    Facade.setFacadeApplication(app);
    Facade.clearResolvedInstances();
  });

  afterEach(() => {
    Facade.setFacadeApplication(undefined as unknown as Application);
    Facade.clearResolvedInstances();
  });

  it('binds the manager as hash and the facade round-trips (AC)', () => {
    expect(app.bound('hash')).toBe(true);

    const hashed = Hash.make('secret');

    expect(Hash.check('secret', hashed)).toBe(true);
    expect(Hash.check('wrong', hashed)).toBe(false);
    expect(Hash.needsRehash(hashed)).toBe(false);
    expect(() => Hash.verifyConfiguration()).not.toThrow();
  });

  it('exposes the helper in both shapes', () => {
    const hashed = hash('secret');

    expect(hashed.startsWith('$scrypt$')).toBe(true);
    expect(hash().check('secret', hashed)).toBe(true);
    expect(hash().getDefaultDriver()).toBe('scrypt');
    expect(hash().driver()).toBeInstanceOf(ScryptHasher);
  });

  it('keeps scrypt as the default when nothing is configured', () => {
    const bare = new Application('/test-bare');
    bare.register(HashServiceProvider);

    const manager = bare.make<HashManager>('hash');

    expect(manager.getDefaultDriver()).toBe('scrypt');
    expect(manager.driver()).toBeInstanceOf(ScryptHasher);
  });
});

/**
 * An in-memory double of the bcrypt module API: `$2b$<rounds>$<digest>`
 * where the digest is a deterministic base64-ish stand-in for the real
 * bcrypt output. Enough to exercise the adapter logic without the native
 * package.
 */
function fakeBcrypt(): {
  hashSync(value: string, rounds: number): string;
  compareSync(value: string, hashed: string): boolean;
} {
  return {
    hashSync(value: string, rounds: number): string {
      // Only bcrypt's [./A-Za-z0-9] alphabet so the real hash pattern matches
      const digest = Buffer.from(`bcrypt:${rounds}:${value}`).toString('hex').padEnd(53, '0').slice(0, 53);
      return `$2b$${String(rounds).padStart(2, '0')}$${digest}`;
    },
    compareSync(value: string, hashed: string): boolean {
      const rounds = Number(hashed.slice(4, 6));
      return this.hashSync(value, rounds) === hashed;
    },
  };
}

/**
 * An in-memory double of the argon2 module API producing real-shaped PHC
 * strings (`$argon2id$v=19$m=...,t=...,p=...$<salt>$<digest>`).
 */
function fakeArgon2(): {
  argon2id: number;
  argon2i: number;
  argon2d: number;
  hashSync(value: string, options?: Record<string, any>): string;
  verifySync(hashed: string, value: string): boolean;
} {
  const fake = {
    argon2id: 2,
    argon2i: 1,
    argon2d: 0,
    hashSync(value: string, options: Record<string, any> = {}): string {
      const m = options.memoryCost ?? 65536;
      const t = options.timeCost ?? 4;
      const p = options.parallelism ?? 2;
      const digest = Buffer.from(`argon2:${m}:${t}:${p}:${value}`).toString('base64');
      return `$argon2id$v=19$m=${m},t=${t},p=${p}$c2FsdA$${digest}`;
    },
    verifySync(hashed: string, value: string): boolean {
      const match = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(hashed);
      if (!match) {
        return false;
      }
      return (
        fake.hashSync(value, {
          memoryCost: Number(match[1]),
          timeCost: Number(match[2]),
          parallelism: Number(match[3]),
        }) === hashed
      );
    },
  };
  return fake;
}
