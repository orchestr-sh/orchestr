/**
 * Tagged cache tests
 *
 * TaggedCache must work on every store shape - the in-memory Redis
 * double and the real file driver alike - and tag flushes must detach
 * exactly the tagged entries while leaving other keys alone.
 */

import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Repository } from '@/Cache/Repository';
import { ArrayStore } from '@/Cache/Stores/ArrayStore';
import { FileStore } from '@/Cache/Stores/FileStore';
import { RedisStore } from '@/Cache/Stores/RedisStore';
import { FakeRedisClient } from './support/FakeRedisClient';

interface SuiteHooks {
  /** Runs before each test of the suite */
  setup?: () => void | Promise<void>;

  /** Runs after each test of the suite */
  teardown?: () => void | Promise<void>;
}

function suite(name: string, makeRepository: () => Repository, hooks: SuiteHooks = {}): void {
  describe(`${name}: tagged cache`, () => {
    let repo: Repository;

    beforeEach(async () => {
      if (hooks.setup) {
        await hooks.setup();
      }

      repo = makeRepository();
    });

    afterEach(async () => {
      if (hooks.teardown) {
        await hooks.teardown();
      }
    });

    it('stores and reads tagged items', async () => {
      const tagged = repo.tags(['people', 'artists']);

      expect(await tagged.put('John', { name: 'John' }, 3600)).toBe(true);
      expect(await tagged.get('John')).toEqual({ name: 'John' });
      expect(await tagged.has('John')).toBe(true);
    });

    it('keeps tag namespaces apart', async () => {
      const people = repo.tags(['people', 'artists']);
      const authors = repo.tags(['people', 'authors']);

      await people.put('shared', 'from-artists', 3600);
      await authors.put('shared', 'from-authors', 3600);

      expect(await people.get('shared')).toBe('from-artists');
      expect(await authors.get('shared')).toBe('from-authors');
    });

    it('flushes by tag without touching other keys', async () => {
      const tagged = repo.tags('people');

      await tagged.put('Jane', 'value', 3600);
      await repo.put('untouched', 'still-here', 3600);

      expect(await tagged.flush()).toBe(true);

      expect(await tagged.get('Jane')).toBeNull();
      expect(await repo.get('untouched')).toBe('still-here');
    });

    it('re-renders values through remember() and forget()', async () => {
      const tagged = repo.tags('people');

      let calls = 0;
      const remember = await tagged.remember('key', 3600, () => {
        calls++;

        return 'value';
      });

      expect(remember).toBe('value');

      const again = await tagged.remember('key', 3600, () => {
        calls++;

        return 'other';
      });

      expect(again).toBe('value');
      expect(calls).toBe(1);

      expect(await tagged.forget('key')).toBe(true);
      expect(await tagged.get('key')).toBeNull();
    });

    it('increments and decrements tagged counters', async () => {
      const tagged = repo.tags('stats');

      expect(await tagged.increment('hits', 5)).toBe(5);
      expect(await tagged.decrement('hits', 1)).toBe(4);
    });
  });
}

suite('ArrayStore', () => new Repository(new ArrayStore({ serialize: false })).setStoreName('array'));

suite('RedisStore', () => new Repository(new RedisStore({}, 'cache_', new FakeRedisClient())).setStoreName('redis'));

let fileDir: string;

suite('FileStore', () => new Repository(new FileStore({ path: fileDir }, 'cache_')).setStoreName('file'), {
  setup: async () => {
    fileDir = await mkdtemp(path.join(tmpdir(), 'orchestr-cache-tags-'));
  },
  teardown: async () => {
    await rm(fileDir, { recursive: true, force: true });
  },
});
