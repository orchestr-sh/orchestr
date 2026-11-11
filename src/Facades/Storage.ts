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
import type { FilesystemManager } from '@/Filesystem/FilesystemManager';
import { Facade } from '@/Support/Facade';

class StorageFacadeClass extends Facade {
  protected static getFacadeAccessor(): string {
    return 'filesystem';
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
