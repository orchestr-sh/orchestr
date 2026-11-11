/**
 * FilesystemDisk
 *
 * The caller-facing Disk object: it names a configured disk, delegates the
 * primitive operations to its FilesystemAdapter and adds the conveniences
 * Laravel's FilesystemAdapter builds on top of the contract - putFile /
 * putFileAs, missing, allFiles, bulk delete and temporaryUrl. UploadedFile
 * storage flows through here, so the upload layer never touches a concrete
 * driver (DRY).
 */

import type { Disk, Uploadable, WriteOptions } from './Contracts/Disk';
import type { FilesystemAdapter } from './Contracts/FilesystemAdapter';

export class FilesystemDisk implements Disk {
  constructor(
    public readonly name: string,
    protected adapter: FilesystemAdapter
  ) {}

  /**
   * The low-level driver behind this disk
   */
  getAdapter(): FilesystemAdapter {
    return this.adapter;
  }

  put(path: string, contents: string | Buffer, options: WriteOptions = {}): Promise<boolean> {
    return this.adapter.put(path, contents, options);
  }

  async putFile(directory: string, file: Uploadable, options: WriteOptions = {}): Promise<string | false> {
    return this.putFileAs(directory, file, file.hashName(), options);
  }

  async putFileAs(
    directory: string,
    file: Uploadable,
    name: string,
    options: WriteOptions = {}
  ): Promise<string | false> {
    const path = joinSegments(directory, name);

    try {
      return (await this.put(path, await file.get(), options)) ? path : false;
    } catch {
      return false;
    }
  }

  get(path: string): Promise<Buffer | null> {
    return this.adapter.get(path);
  }

  exists(path: string): Promise<boolean> {
    return this.adapter.exists(path);
  }

  async missing(path: string): Promise<boolean> {
    return !(await this.adapter.exists(path));
  }

  async delete(path: string | string[]): Promise<boolean> {
    const paths = Array.isArray(path) ? path : [path];
    let success = true;

    for (const each of paths) {
      success = (await this.adapter.delete(each)) && success;
    }

    return success;
  }

  copy(source: string, destination: string): Promise<boolean> {
    return this.adapter.copy(source, destination);
  }

  move(source: string, destination: string): Promise<boolean> {
    return this.adapter.move(source, destination);
  }

  size(path: string): Promise<number> {
    return this.adapter.size(path);
  }

  lastModified(path: string): Promise<number> {
    return this.adapter.lastModified(path);
  }

  files(directory = ''): Promise<string[]> {
    return this.adapter.listFiles(directory, false);
  }

  allFiles(): Promise<string[]> {
    return this.adapter.listFiles('', true);
  }

  directories(directory = ''): Promise<string[]> {
    return this.adapter.listDirectories(directory, false);
  }

  allDirectories(): Promise<string[]> {
    return this.adapter.listDirectories('', true);
  }

  makeDirectory(directory: string): Promise<boolean> {
    return this.adapter.makeDirectory(directory);
  }

  deleteDirectory(directory: string): Promise<boolean> {
    return this.adapter.deleteDirectory(directory);
  }

  url(path: string, _options: WriteOptions = {}): string {
    return this.adapter.url(path);
  }

  path(path: string): string {
    return this.adapter.path(path);
  }

  async temporaryUrl(path: string, expiration: Date | number, options: WriteOptions = {}): Promise<string> {
    if (!this.adapter.temporaryUrl) {
      throw new Error('This driver does not support creating temporary URLs.');
    }

    return await this.adapter.temporaryUrl(path, expiration, options);
  }
}

/**
 * Join a directory prefix and a name with a single slash, keeping root
 * writes (no directory) to just the name - the way Laravel prefixes
 * hashName() with the path argument.
 */
function joinSegments(directory: string, name: string): string {
  const trimmed = String(directory ?? '')
    .replace(/\/+$/, '')
    .replace(/^\/+/, '');

  return trimmed === '' ? name : `${trimmed}/${name}`;
}
