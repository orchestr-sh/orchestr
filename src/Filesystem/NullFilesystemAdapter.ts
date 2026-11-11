/**
 * NullFilesystemAdapter
 *
 * Accepts every write and returns nothing, mirroring Laravel's
 * Illuminate\Filesystem\NullFilesystemAdapter. Useful in tests and in
 * environments where persisted storage should be a no-op.
 */

import type { FilesystemAdapter, WriteOptions } from './Contracts/FilesystemAdapter';

export class NullFilesystemAdapter implements FilesystemAdapter {
  async get(_path: string): Promise<Buffer | null> {
    return null;
  }

  async put(_path: string, _contents: string | Buffer, _options?: WriteOptions): Promise<boolean> {
    return true;
  }

  async exists(_path: string): Promise<boolean> {
    return false;
  }

  async delete(_path: string): Promise<boolean> {
    return true;
  }

  async copy(_source: string, _destination: string): Promise<boolean> {
    return true;
  }

  async move(_source: string, _destination: string): Promise<boolean> {
    return true;
  }

  async size(_path: string): Promise<number> {
    return 0;
  }

  async lastModified(_path: string): Promise<number> {
    return 0;
  }

  async listFiles(_directory: string, _recursive: boolean): Promise<string[]> {
    return [];
  }

  async listDirectories(_directory: string, _recursive: boolean): Promise<string[]> {
    return [];
  }

  async makeDirectory(_directory: string): Promise<boolean> {
    return true;
  }

  async deleteDirectory(_directory: string): Promise<boolean> {
    return true;
  }

  url(_path: string): string {
    return '';
  }

  path(path: string): string {
    return String(path);
  }
}
