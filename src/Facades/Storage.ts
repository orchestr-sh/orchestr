/**
 * Storage Facade
 *
 * Provides static access to the filesystem manager and, for convenience,
 * the default disk.
 *
 * @example
 * ```typescript
 * import { Storage } from '@orchestr-sh/orchestr';
 *
 * await Storage.put('hello.txt', 'Hello World');   // default disk
 * const contents = await Storage.get('hello.txt');
 *
 * Storage.disk('local').url('avatars/photo.png'); // explicit disk
 * Storage.disk('public').url('avatars/photo.png'); // '/storage/avatars/photo.png'
 * ```
 */

import type { Disk } from '@/Filesystem/Contracts/Disk';
import type { FilesystemConfig, FilesystemManager } from '@/Filesystem/FilesystemManager';
import type { StorageFake } from '@/Support/Testing/Fakes/StorageFake';
import { Facade } from '@/Support/Facade';
import { createStorageFake } from '@/Support/Testing/Fakes/StorageFake';

class StorageFacadeClass extends Facade {
  protected static getFacadeAccessor(): string {
    return 'filesystem';
  }

  /**
   * Swap the given disks (all of them by default) for in-memory fakes:
   * writes land in process memory and the returned fake exposes
   * Laravel-style storage assertions.
   *
   * @returns StorageFake instance for making assertions
   *
   * @example
   * ```typescript
   * const storage = Storage.fake();
   *
   * await Storage.put('welcome.txt', 'Hello');
   *
   * await storage.assertExists('welcome.txt');
   * await storage.assertMissing('goodbye.txt');
   * ```
   */
  static fake(disks?: string | string[]): StorageFake {
    const app = this.getFacadeApplication();

    if (!app) {
      throw new Error('Application not initialized. Cannot fake the filesystem.');
    }

    let config: Partial<FilesystemConfig> = {};

    try {
      config = ((app.make('config') as any).get?.('filesystems') ?? {}) as Partial<FilesystemConfig>;
    } catch {
      // No config repository: the fake runs on Laravel's default disks
    }

    const { manager, fake } = createStorageFake(config, disks);

    app.instance('filesystem', manager);

    // Drop any cached facade root so subsequent Storage.* calls resolve the fake.
    this.clearResolvedInstance('filesystem');

    return fake;
  }
}

export const Storage = new Proxy(StorageFacadeClass, {
  get(target, prop) {
    // First check if it's a static method on the facade class itself
    if (prop in target) {
      const value = (target as any)[prop];
      if (typeof value === 'function') {
        return value.bind(target);
      }
      return value;
    }

    // Then try to get from the facade root (the FilesystemManager instance)
    try {
      const root = (target as any).getFacadeRoot() as FilesystemManager;
      if (root && prop in root) {
        const value = (root as any)[prop];
        if (typeof value === 'function') {
          return (...args: any[]) => value.apply(root, args);
        }
        return value;
      }

      // Also proxy to the default disk for convenience
      const disk = root.disk() as Disk;
      if (disk && prop in disk) {
        const value = (disk as any)[prop];
        if (typeof value === 'function') {
          return (...args: any[]) => value.apply(disk, args);
        }
        return value;
      }
    } catch (error) {
      // Facade root not available yet
    }

    return undefined;
  },
}) as unknown as typeof StorageFacadeClass & FilesystemManager & Disk;
