import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Storage } from '@/Facades/Storage';
import { FilesystemManager } from '@/Filesystem/FilesystemManager';
import { FilesystemServiceProvider } from '@/Filesystem/FilesystemServiceProvider';
import { Application } from '@/Foundation/Application';
import { Config } from '@/Foundation/Config/Config';
import { Facade } from '@/Support/Facade';
import { storage_path } from '@/Support/helpers';

describe('Storage facade and storage_path helper', () => {
  let directory: string;
  let app: Application;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'orchestr-storage-'));
    app = new Application(directory);
    app.instance('config', new Config({ filesystems: { default: 'local' } }));
    app.register(FilesystemServiceProvider);
    Facade.setFacadeApplication(app);
    Facade.clearResolvedInstances();
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('forwards disk calls to the default disk', async () => {
    expect(await Storage.put('notes/hello.txt', 'Hello World')).toBe(true);
    expect((await Storage.get('notes/hello.txt'))?.toString()).toBe('Hello World');
    expect(await Storage.exists('notes/hello.txt')).toBe(true);

    expect(await Storage.delete('notes/hello.txt')).toBe(true);
    expect(await Storage.missing('notes/hello.txt')).toBe(true);
  });

  it('exposes disk() from the manager and per-disk URLs', async () => {
    expect(Storage.disk('public')).toBe(app.make<FilesystemManager>('filesystem').disk('public'));

    await Storage.disk('public').put('avatars/photo.png', 'x');

    expect(Storage.disk('public').url('avatars/photo.png')).toBe('/storage/avatars/photo.png');
  });

  it('routes Storage.url through the configured default disk', () => {
    const second = new Application(directory);
    second.instance('config', new Config({ filesystems: { default: 'public' } }));
    second.register(FilesystemServiceProvider);
    Facade.setFacadeApplication(second);
    Facade.clearResolvedInstances();

    expect(Storage.url('report.pdf')).toBe('/storage/report.pdf');

    Facade.setFacadeApplication(app);
    Facade.clearResolvedInstances();
  });

  it('storage_path resolves inside the application storage directory', () => {
    expect(storage_path()).toBe(`${directory}/storage`);
    expect(storage_path('app/file.txt')).toBe(`${directory}/storage/app/file.txt`);
  });
});
