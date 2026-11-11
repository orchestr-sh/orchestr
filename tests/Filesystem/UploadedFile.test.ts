import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FilesystemAdapter } from '@/Filesystem/Contracts/FilesystemAdapter';
import { FilesystemManager } from '@/Filesystem/FilesystemManager';
import { FilesystemServiceProvider } from '@/Filesystem/FilesystemServiceProvider';
import { Application } from '@/Foundation/Application';
import { Config } from '@/Foundation/Config/Config';
import { FileUploadException } from '@/Routing/FileUploadException';
import {
  UploadedFile,
  isUploadedFile,
  UPLOAD_ERR_INI_SIZE,
  UPLOAD_ERR_NO_FILE,
  UPLOAD_ERR_OK,
} from '@/Routing/UploadedFile';

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00,
  0x04, 0x00, 0x00, 0x00, 0x02,
]);

describe('UploadedFile', () => {
  let directory: string;
  let app: Application;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'orchestr-uploads-'));
    app = new Application(directory);
    app.instance('config', new Config({ filesystems: {} }));
    app.register(FilesystemServiceProvider);
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  const disk = (name?: string) => app.make<FilesystemManager>('filesystem').disk(name);

  describe('client metadata', () => {
    it('exposes the getters Laravel reports from the request', () => {
      const file = new UploadedFile({ name: 'C:\\Users\\me\\Photos\\Holiday.PNG', contents: PNG_BYTES });

      expect(file.getClientOriginalName()).toBe('Holiday.PNG');
      expect(file.getClientOriginalExtension()).toBe('png');
      expect(file.getClientMimeType()).toBe('image/png');
      expect(file.getSize()).toBe(PNG_BYTES.byteLength);
      expect(file.getError()).toBe(UPLOAD_ERR_OK);
      expect(file.isValid()).toBe(true);
      expect(isUploadedFile(file)).toBe(true);
      expect(isUploadedFile({})).toBe(false);
    });

    it('keeps the client-declared media type over name guessing', () => {
      const file = new UploadedFile({ name: 'data.json', contents: Buffer.from('{}'), mimeType: 'text/plain' });

      expect(file.getClientMimeType()).toBe('text/plain');
    });

    it('flags failed uploads and reports their error codes', () => {
      const tooBig = new UploadedFile({ name: 'big.zip', error: UPLOAD_ERR_INI_SIZE });
      const missing = new UploadedFile({ name: '', error: UPLOAD_ERR_NO_FILE });

      expect(tooBig.isValid()).toBe(false);
      expect(tooBig.getError()).toBe(UPLOAD_ERR_INI_SIZE);
      expect(missing.getSize()).toBe(0);
      expect(missing.getRealPath()).toBeNull();
    });

    it('hash-names keep the guessed extension and stay random', () => {
      const first = new UploadedFile({ name: 'photo.png', contents: PNG_BYTES });
      const second = new UploadedFile({ name: 'photo.png', contents: PNG_BYTES });

      expect(first.hashName()).toMatch(/^[a-zA-Z0-9]{40}\.png$/);
      expect(first.hashName()).not.toBe(second.hashName());

      const noExtension = new UploadedFile({ name: 'LICENSE', contents: Buffer.from('x') });
      expect(noExtension.hashName()).toMatch(/^[a-zA-Z0-9]{40}$/);
    });
  });

  describe('store', () => {
    it('writes to the configured default disk and returns the stored path', async () => {
      const file = new UploadedFile({ name: 'holiday.png', contents: PNG_BYTES, mimeType: 'image/png' });

      const stored = await file.store('avatars');

      expect(stored).not.toBe(false);
      expect(String(stored)).toMatch(/^avatars\/[a-zA-Z0-9]{40}\.png$/);
      expect(await disk().exists(String(stored))).toBe(true);
      expect((await disk().get(String(stored)))?.equals(PNG_BYTES)).toBe(true);
      expect(existsSync(join(directory, 'storage/app', String(stored)))).toBe(true);
    });

    it('stores at the disk root when no directory is given', async () => {
      const file = new UploadedFile({ name: 'notes.txt', contents: Buffer.from('text') });

      const stored = await file.store();

      expect(String(stored)).toMatch(/^[a-zA-Z0-9]{40}\.txt$/);
      expect(await disk().exists(String(stored))).toBe(true);
    });

    it('stores under an explicit name with storeAs', async () => {
      const file = new UploadedFile({ name: 'holiday.png', contents: PNG_BYTES });

      expect(await file.storeAs('avatars', 'me.png')).toBe('avatars/me.png');
      expect((await disk().get('avatars/me.png'))?.equals(PNG_BYTES)).toBe(true);
    });

    it('honours the disk option', async () => {
      const file = new UploadedFile({ name: 'holiday.png', contents: PNG_BYTES });

      const stored = await file.store('shared', { disk: 'public' });

      expect(String(stored)).toMatch(/^shared\/[a-zA-Z0-9]{40}\.png$/);
      expect(existsSync(join(directory, 'storage/app/public', String(stored)))).toBe(true);
    });

    it('storePublicly targets the public disk', async () => {
      const file = new UploadedFile({ name: 'holiday.png', contents: PNG_BYTES });

      const stored = await file.storePublicly('avatars');

      expect(String(stored)).toMatch(/^avatars\/[a-zA-Z0-9]{40}\.png$/);
      expect(existsSync(join(directory, 'storage/app/public', String(stored)))).toBe(true);
      expect(disk('public').url(String(stored))).toBe(`/storage/${stored}`);
    });

    it('storePubliclyAs writes an explicit name to the public disk', async () => {
      const file = new UploadedFile({ name: 'holiday.png', contents: PNG_BYTES });

      expect(await file.storePubliclyAs('avatars', 'team.png')).toBe('avatars/team.png');
      expect(existsSync(join(directory, 'storage/app/public/avatars/team.png'))).toBe(true);
    });

    it('returns false for uploads that did not arrive', async () => {
      const failed = new UploadedFile({ name: 'holiday.png', error: UPLOAD_ERR_INI_SIZE });

      expect(await failed.store('avatars')).toBe(false);
      expect(await failed.storeAs('avatars', 'me.png')).toBe(false);
      await expect(failed.get()).rejects.toBeInstanceOf(FileUploadException);
    });

    it('returns false when the disk write fails', async () => {
      const manager = new FilesystemManager(
        { default: 'broken', disks: { broken: { driver: 'unwritable' } } },
        directory
      );

      manager.extend(
        'unwritable',
        (): FilesystemAdapter => ({
          async get() {
            return null;
          },
          async put() {
            return false;
          },
          async exists() {
            return false;
          },
          async delete() {
            return false;
          },
          async copy() {
            return false;
          },
          async move() {
            return false;
          },
          async size() {
            return 0;
          },
          async lastModified() {
            return 0;
          },
          async listFiles() {
            return [];
          },
          async listDirectories() {
            return [];
          },
          async makeDirectory() {
            return false;
          },
          async deleteDirectory() {
            return false;
          },
          url(path) {
            return `unwritable://${path}`;
          },
          path: (p) => p,
        })
      );

      app.instance('filesystem', manager);

      const file = new UploadedFile({ name: 'holiday.png', contents: PNG_BYTES });

      expect(await file.store('x', { disk: 'broken' })).toBe(false);
    });

    it('explains itself when storage is not registered', async () => {
      const bareDirectory = mkdtempSync(join(tmpdir(), 'orchestr-bare-'));
      new Application(bareDirectory); // now the global app, with no filesystem binding
      const file = new UploadedFile({ name: 'holiday.png', contents: PNG_BYTES });

      await expect(file.store('avatars')).rejects.toThrow(/Storage is not available/);

      rmSync(bareDirectory, { recursive: true, force: true });
    });
  });

  describe('contents', () => {
    it('reads bytes back through get()', async () => {
      const file = new UploadedFile({ name: 'holiday.png', contents: PNG_BYTES });

      expect((await file.get()).equals(PNG_BYTES)).toBe(true);
    });

    it('reads uploads that live on disk', async () => {
      const source = join(directory, 'tmp-upload.bin');
      writeFileSync(source, 'from disk');

      const file = new UploadedFile({ name: 'from-disk.txt', path: source });

      expect(file.isValid()).toBe(true);
      expect(file.getSize()).toBe(9);
      expect((await file.get()).toString()).toBe('from disk');
      expect(readFileSync(source).toString()).toBe('from disk');
    });
  });
});
