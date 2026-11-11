import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileNotFoundException } from '@/Filesystem/FileNotFoundException';
import { FilesystemDisk } from '@/Filesystem/FilesystemDisk';
import { FilesystemManager, FILESYSTEM_DEFAULTS } from '@/Filesystem/FilesystemManager';
import { LocalFilesystemAdapter } from '@/Filesystem/LocalFilesystemAdapter';
import { NullFilesystemAdapter } from '@/Filesystem/NullFilesystemAdapter';
import { PathTraversalException } from '@/Filesystem/PathTraversalException';
import { Str } from '@/Support/Str';

describe('FilesystemManager', () => {
  let directory: string;
  let manager: FilesystemManager;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'orchestr-fs-'));
    manager = new FilesystemManager({ disks: {} }, directory);
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  describe('disk resolution', () => {
    it('exposes the local, public and null disks by default', () => {
      expect(manager.getDiskNames()).toEqual(['local', 'public', 'null']);
      expect(manager.getDefaultDriver()).toBe('local');
      expect(manager.disk()).toBeInstanceOf(FilesystemDisk);
      expect(manager.disk().name).toBe('local');
      expect(manager.disk('null').getAdapter()).toBeInstanceOf(NullFilesystemAdapter);
    });

    it('roots the default disks under the application path', () => {
      expect(manager.disk('local').path('x.txt')).toBe(join(directory, 'storage/app/x.txt'));
      expect(manager.disk('public').path('x.txt')).toBe(join(directory, 'storage/app/public/x.txt'));
    });

    it('honours configured roots and URLs', () => {
      const configured = new FilesystemManager(
        {
          default: 'upload',
          disks: {
            upload: { driver: 'local', root: '/abs/upload/root', url: 'https://cdn.example/files/' },
          },
        },
        directory
      );

      expect(configured.getDefaultDriver()).toBe('upload');
      expect(configured.disk().path('photo.png')).toBe('/abs/upload/root/photo.png');
      expect(configured.disk().url('photo.png')).toBe('https://cdn.example/files/photo.png');
    });

    it('merges configured disks over the built-in defaults', () => {
      const configured = new FilesystemManager(
        {
          disks: {
            local: { driver: 'local', root: join(directory, 'custom-root') },
            tmp: { driver: 'local', root: join(directory, 'tmp') },
          },
        },
        directory
      );

      expect(configured.getDiskNames()).toEqual(expect.arrayContaining(['local', 'public', 'null', 'tmp']));
      expect(configured.disk('local').path('a.txt')).toBe(join(directory, 'custom-root/a.txt'));
    });

    it('caches disk instances until they are purged', () => {
      const cached = manager.disk('local');
      expect(manager.disk('local')).toBe(cached);
      expect(manager.disk()).toBe(cached);

      manager.purge('local');
      expect(manager.disk('local')).not.toBe(cached);

      manager.purgeAll();
      expect(manager.disk()).toBeInstanceOf(FilesystemDisk);
    });

    it('rejects unknown disks and unknown drivers', () => {
      expect(() => manager.disk('nope')).toThrow(/Disk \[nope\] is not defined/);

      const configured = new FilesystemManager({ disks: { weird: { driver: 'ftp' } } }, directory);
      expect(() => configured.disk('weird')).toThrow(/Filesystem driver \[ftp\] is not supported/);
    });

    it('registers custom drivers through extend (S3-style, no caller changes)', async () => {
      const memoryAdapter = new Map<string, Buffer>();

      const custom = new FilesystemManager({ default: 'cache', disks: { cache: { driver: 'memory' } } }, directory);

      custom.extend('memory', (config) => {
        expect(config.driver).toBe('memory');

        return {
          async get(path) {
            return memoryAdapter.get(path) ?? null;
          },
          async put(path, contents) {
            memoryAdapter.set(path, Buffer.from(String(contents)));
            return true;
          },
          async exists(path) {
            return memoryAdapter.has(path);
          },
          async delete(path) {
            return memoryAdapter.delete(path);
          },
          async copy() {
            return true;
          },
          async move() {
            return true;
          },
          async size(path) {
            return memoryAdapter.get(path)?.byteLength ?? 0;
          },
          async lastModified() {
            return 0;
          },
          async listFiles() {
            return Array.from(memoryAdapter.keys());
          },
          async listDirectories() {
            return [];
          },
          async makeDirectory() {
            return true;
          },
          async deleteDirectory() {
            return true;
          },
          url(path) {
            return `memory://files/${path}`;
          },
          path(path) {
            return `memory://files/${path}`;
          },
        };
      });

      const disk = custom.disk('cache');

      await disk.put('note.txt', 'persisted');

      expect(memoryAdapter.get('note.txt')?.toString()).toBe('persisted');
      expect(disk.url('note.txt')).toBe('memory://files/note.txt');
    });
  });

  describe('local disk operations', () => {
    const disk = () => manager.disk('local');

    it('writes, reads, checks and deletes files', async () => {
      expect(await disk().put('notes/hello.txt', 'Hello World')).toBe(true);
      expect(existsSync(join(directory, 'storage/app/notes/hello.txt'))).toBe(true);

      const contents = await disk().get('notes/hello.txt');
      expect(contents?.toString()).toBe('Hello World');

      expect(await disk().exists('notes/hello.txt')).toBe(true);
      expect(await disk().missing('notes/hello.txt')).toBe(false);
      expect(await disk().missing('notes/gone.txt')).toBe(true);

      expect(await disk().delete('notes/hello.txt')).toBe(true);
      expect(await disk().get('notes/hello.txt')).toBeNull();
      expect(await disk().delete('notes/hello.txt')).toBe(false);
    });

    it('deletes several paths in one call', async () => {
      await disk().put('a.txt', 'a');
      await disk().put('b.txt', 'b');

      expect(await disk().delete(['a.txt', 'b.txt'])).toBe(true);
      expect(await disk().exists('a.txt')).toBe(false);
      expect(await disk().exists('b.txt')).toBe(false);

      expect(await disk().delete(['a.txt', 'b.txt'])).toBe(false);
    });

    it('copies and moves files', async () => {
      await disk().put('src.txt', 'content');

      expect(await disk().copy('src.txt', 'nested/copy.txt')).toBe(true);
      expect(await disk().get('nested/copy.txt')).not.toBeNull();

      expect(await disk().move('src.txt', 'nested/moved.txt')).toBe(true);
      expect(await disk().exists('src.txt')).toBe(false);
      expect((await disk().get('nested/moved.txt'))?.toString()).toBe('content');

      expect(await disk().copy('missing.txt', 'never.txt')).toBe(false);
    });

    it('reports size and last-modified times', async () => {
      const before = Math.floor(Date.now() / 1000);

      await disk().put('metered.txt', '12345');

      expect(await disk().size('metered.txt')).toBe(5);
      expect(await disk().lastModified('metered.txt')).toBeGreaterThanOrEqual(before);

      await expect(disk().size('metered-missing.txt')).rejects.toThrow(FileNotFoundException);
    });

    it('lists files and directories, shallow and recursively', async () => {
      await disk().put('root.txt', '1');
      await disk().put('docs/a.md', '2');
      await disk().put('docs/deep/b.md', '3');

      expect(await disk().files()).toEqual(['root.txt']);
      expect(await disk().files('docs')).toEqual(['docs/a.md']);
      expect(await disk().allFiles()).toEqual(expect.arrayContaining(['root.txt', 'docs/a.md', 'docs/deep/b.md']));
      expect(await disk().allFiles()).toHaveLength(3);

      expect(await disk().directories()).toEqual(['docs']);
      expect(await disk().directories('docs')).toEqual(['docs/deep']);
      expect(await disk().allDirectories()).toEqual(['docs', 'docs/deep']);

      expect(await disk().files('nowhere')).toEqual([]);
    });

    it('makes and deletes directories', async () => {
      expect(await disk().makeDirectory('build/cache')).toBe(true);
      expect(existsSync(join(directory, 'storage/app/build/cache'))).toBe(true);

      await disk().put('build/cache/thing.js', 'x');

      expect(await disk().deleteDirectory('build')).toBe(true);
      expect(existsSync(join(directory, 'storage/app/build'))).toBe(false);
    });

    it('writes atomically, leaving no partial files behind', async () => {
      await disk().put('atomic.txt', Buffer.from('final bytes'));

      const siblings = readdirSync(join(directory, 'storage/app'));

      expect(siblings.filter((entry) => entry.endsWith('.tmp'))).toHaveLength(0);
      expect(readFileSync(join(directory, 'storage/app/atomic.txt')).toString()).toBe('final bytes');

      // Overwriting swaps the file in one rename
      await disk().put('atomic.txt', 'replaced');
      expect(readFileSync(join(directory, 'storage/app/atomic.txt')).toString()).toBe('replaced');
    });
  });

  describe('path traversal protection', () => {
    it('rejects .. escapes on every operation', async () => {
      await expect(diskPut('../escape.txt', 'never lands')).rejects.toBeInstanceOf(PathTraversalException);
      await expect(manager.disk('local').get('../../etc/passwd')).rejects.toBeInstanceOf(PathTraversalException);
      expect(() => manager.disk('local').path('a/../../b')).toThrow(PathTraversalException);
      expect(() => manager.disk('local').url('../b')).toThrow(PathTraversalException);

      expect(existsSync(join(directory, 'escape.txt'))).toBe(false);
    });

    it('rejects even .. segments that would normalize back inside the jail', async () => {
      await expect(manager.disk('local').put('notes/../notes/x.txt', 'x')).rejects.toBeInstanceOf(
        PathTraversalException
      );
    });

    it('anchors leading slashes inside the root instead of the filesystem', async () => {
      const disk = manager.disk('local');

      expect(disk.path('/tmp/sneaky.txt')).toBe(join(directory, 'storage/app/tmp/sneaky.txt'));
      expect(await disk.put('/tmp/sneaky.txt', 'safe')).toBe(true);
      expect(readFileSync(join(directory, 'storage/app/tmp/sneaky.txt')).toString()).toBe('safe');
      expect(existsSync('/tmp/sneaky.txt')).toBe(false);
    });
  });

  describe('URLs', () => {
    it('returns configured public URLs', async () => {
      expect(manager.disk('public').url('avatars/photo.png')).toBe('/storage/avatars/photo.png');
      expect(manager.disk('public').url('/avatars/photo.png')).toBe('/storage/avatars/photo.png');

      await manager.disk('public').put('avatars/photo.png', 'x');
      expect(existsSync(join(directory, 'storage/app/public/avatars/photo.png'))).toBe(true);
    });

    it('throws when the disk has no configured URL', () => {
      expect(() => manager.disk('local').url('secret.txt')).toThrow(/does not support generating public URLs/);
    });

    it('rejects temporary URLs on the local driver', async () => {
      await expect(manager.disk('local').temporaryUrl('x.txt', 60)).rejects.toThrow(
        /does not support creating temporary URLs/
      );
    });
  });

  describe('null disk', () => {
    it('accepts writes and yields nothing', async () => {
      const disk = manager.disk('null');

      expect(await disk.put('anything.txt', 'contents')).toBe(true);
      expect(await disk.get('anything.txt')).toBeNull();
      expect(await disk.exists('anything.txt')).toBe(false);
      expect(await disk.missing('anything.txt')).toBe(true);
      expect(await disk.allFiles()).toEqual([]);
      expect(await disk.delete('anything.txt')).toBe(true);

      const written = await disk.putFile('dir', {
        hashName: () => 'hashed.txt',
        get: async () => Buffer.from('ignored'),
        getClientMimeType: () => 'text/plain',
      });

      expect(written).toBe('dir/hashed.txt');
      expect(disk.url('anything.txt')).toBe('');
    });
  });

  function diskPut(path: string, contents: string): Promise<boolean> {
    return manager.disk('local').put(path, contents);
  }

  describe('defaults export', () => {
    it('mirrors the Laravel disk table', () => {
      expect(FILESYSTEM_DEFAULTS.default).toBe('local');
      expect(FILESYSTEM_DEFAULTS.disks.local).toEqual({ driver: 'local', root: 'storage/app' });
      expect(FILESYSTEM_DEFAULTS.disks.public).toEqual({
        driver: 'local',
        root: 'storage/app/public',
        url: '/storage',
      });
      expect(FILESYSTEM_DEFAULTS.disks.null).toEqual({ driver: 'null' });
    });
  });

  describe('manager proxies', () => {
    it('forwards disk calls to the default disk', async () => {
      await manager.put('proxied.txt', 'via manager');
      expect((await manager.get('proxied.txt'))?.toString()).toBe('via manager');
      expect(await manager.exists('proxied.txt')).toBe(true);
      expect(await manager.size('proxied.txt')).toBe(11);
      expect(manager.path('proxied.txt')).toBe(join(directory, 'storage/app/proxied.txt'));

      await manager.delete('proxied.txt');
      expect(await manager.missing('proxied.txt')).toBe(true);
    });
  });
});

describe('LocalFilesystemAdapter', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'orchestr-fs-adapter-'));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('rejects escaping paths without touching the filesystem', () => {
    const adapter = new LocalFilesystemAdapter({ root: directory });

    expect(() => adapter.path('../outside')).toThrow(PathTraversalException);
    expect(() => adapter.path(`${Str.random(4)}x/../../outside`)).toThrow(PathTraversalException);
    expect(existsSync(join(directory, '..', 'outside'))).toBe(false);
  });

  it('serves files that exist and nulls for missing ones', async () => {
    const adapter = new LocalFilesystemAdapter({ root: directory, url: 'https://cdn.test/' });

    writeFileSync(join(directory, 'real.txt'), 'here');

    expect((await adapter.get('real.txt'))?.toString()).toBe('here');
    expect(await adapter.get('ghost.txt')).toBeNull();
    expect(adapter.url('real.txt')).toBe('https://cdn.test/real.txt');
  });
});
