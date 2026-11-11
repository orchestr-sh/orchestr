/**
 * Ensemble `encrypted` cast
 *
 * The cast stores ciphertext in the attributes (and therefore in the
 * database bindings) while every read path - getAttribute, toObject -
 * returns plaintext, using the Crypt service.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseManager } from '@/Database/DatabaseManager';
import { Ensemble } from '@/Database/Ensemble/Ensemble';
import { Encrypter } from '@/Encryption/Encrypter';
import { EncryptionServiceProvider } from '@/Encryption/EncryptionServiceProvider';
import { Application } from '@/Foundation/Application';
import { Config } from '@/Foundation/Config/Config';
import type { ExecutedQuery } from './Query/support';
import { recordAdapter } from './Query/support';

const KEY = '0123456789abcdef0123456789ABCDEF';

function crypter(): Encrypter {
  return new Encrypter(KEY);
}

/** Point every Ensemble query at a recording adapter and return the log */
function useRecorder(results: Record<string, any> = {}): ExecutedQuery[] {
  const { adapter, queries } = recordAdapter(results);

  const manager = new DatabaseManager({
    default: 'test',
    connections: {
      test: { adapter: 'recording', driver: 'sqlite', database: ':memory:' },
    },
  });
  manager.registerAdapter('recording', () => adapter);
  Ensemble.setConnectionResolver(manager);

  return queries;
}

/** Static casts map: visible to the constructor's fill(), like static fillable */
class Credential extends Ensemble {
  static fillable: string[] = ['id', 'name', 'secret', 'meta'];
  static casts: Record<string, string> = { secret: 'encrypted', meta: 'encrypted' };
  protected timestamps: boolean = false;

  getTable(): string {
    return 'credentials';
  }

  getRawAttributes(): Record<string, any> {
    return this.attributes;
  }
}

/** Instance casts property: applied to writes made after construction */
class Note extends Ensemble {
  static fillable: string[] = ['id', 'body'];
  protected casts = { body: 'encrypted' };
  protected timestamps: boolean = false;

  getTable(): string {
    return 'notes';
  }

  getRawAttributes(): Record<string, any> {
    return this.attributes;
  }
}

describe('Ensemble encrypted cast', () => {
  let encrypter: Encrypter;
  let queries: ExecutedQuery[];

  beforeEach(() => {
    encrypter = crypter();
    queries = useRecorder();
    Ensemble.encryptUsing(encrypter);
  });

  afterEach(() => {
    Ensemble.encryptUsing(null);
  });

  it('stores ciphertext and returns plaintext (AC)', () => {
    const credential = new Credential({ name: 'Ada', secret: 'hunter2' });

    const raw = credential.getRawAttributes();
    expect(raw.secret).not.toBe('hunter2');
    expect(raw.secret).not.toContain('hunter2');
    expect(encrypter.decrypt(raw.secret)).toBe('hunter2');

    expect(credential.getAttribute('secret')).toBe('hunter2');
    expect(credential.getAttribute('name')).toBe('Ada');
    expect(credential.toObject()).toEqual({ name: 'Ada', secret: 'hunter2' });
  });

  it('encrypts structured values and returns them intact', () => {
    const credential = new Credential({ secret: { pin: '1234', tags: ['a'] } });

    expect(credential.getAttribute('secret')).toEqual({ pin: '1234', tags: ['a'] });
    expect(encrypter.decrypt(credential.getRawAttributes().secret)).toEqual({ pin: '1234', tags: ['a'] });
  });

  it('decrypts hydrated rows written as ciphertext', () => {
    const payload = encrypter.encrypt('from-the-vault');
    const hydrated = new Credential({ id: 1, name: 'Grace', secret: payload }, true);

    expect(hydrated.getRawAttributes().secret).toBe(payload);
    expect(hydrated.getAttribute('secret')).toBe('from-the-vault');
  });

  it('leaves null untouched on both sides of the cast', () => {
    const credential = new Credential({ secret: null });

    expect(credential.getRawAttributes().secret).toBeNull();
    expect(credential.getAttribute('secret')).toBeNull();
  });

  it('does not double-encrypt a value that is already an encrypted payload', () => {
    const payload = encrypter.encrypt('stable');

    const note = new Note();
    note.setAttribute('body', payload);

    expect(note.getRawAttributes().body).toBe(payload);
    expect(note.getAttribute('body')).toBe('stable');
  });

  it('applies the instance-property casts form for writes after construction', () => {
    const note = new Note();
    note.setAttribute('body', 'press for secret');

    expect(note.getAttribute('body')).toBe('press for secret');
    expect(note.getRawAttributes().body).not.toBe('press for secret');
  });

  it('writes ciphertext through insert and keeps the plaintext out of the bindings', async () => {
    queries = useRecorder({ insert: 7 });

    const credential = await Credential.create({ name: 'Ada', secret: 'insert-me' });

    const insert = queries.find((query) => query.method === 'insert');
    expect(insert).toBeDefined();
    expect(insert!.bindings).toContain(credential.getRawAttributes().secret);
    expect(insert!.bindings.some((binding) => String(binding).includes('insert-me'))).toBe(false);
    expect(credential.getAttribute('secret')).toBe('insert-me');
  });

  it('persists re-encrypted values through the dirty attributes on update', async () => {
    const payload = encrypter.encrypt('old-secret');
    queries = useRecorder({ select: [[{ id: 1, name: 'Ada', secret: payload }]] });

    const loaded = await Credential.query().where('id', '=', 1).first();
    expect(loaded).not.toBeNull();

    loaded!.setAttribute('secret', 'new-secret');

    const dirty = loaded!.getDirty();
    expect(Object.keys(dirty)).toContain('secret');
    expect(dirty.secret).not.toBe('new-secret');
    expect(encrypter.decrypt(dirty.secret)).toBe('new-secret');

    await loaded!.save();

    const update = queries.find((query) => query.method === 'update');
    expect(update).toBeDefined();
    expect(update!.bindings.some((binding) => String(binding).includes('new-secret'))).toBe(false);
    expect(update!.bindings).toContain(dirty.secret);
  });

  it('resolves the crypter from the container when no resolver was installed', async () => {
    Ensemble.encryptUsing(null);

    const app = new Application('/test-ensemble-crypt');
    app.instance('config', new Config({ app: { key: KEY } }));
    app.register(EncryptionServiceProvider);
    await app.boot();

    const credential = new Credential({ secret: 'via-container' });

    expect(credential.getAttribute('secret')).toBe('via-container');
    expect(app.make<Encrypter>('encrypter').decrypt(credential.getRawAttributes().secret)).toBe('via-container');
  });

  it('explains itself when no crypter is available at all', () => {
    Ensemble.encryptUsing(null);

    // A fresh application with no 'encrypter' binding becomes the global
    // app, so container resolution comes up empty and the cast must fail
    // loudly rather than storing raw secrets
    new Application('/test-ensemble-nocrypt');

    expect(() => new Credential({ secret: 'nowhere' })).toThrow(/crypter is required/i);
  });
});
