/**
 * LocalFilesystemAdapter
 *
 * Stores files under a single root directory on the local disk. Two
 * guarantees set it apart:
 *
 * - Path traversal protection: every operation resolves its path relative
 *   to the root, and any `..` segment that would escape the root is
 *   rejected with a PathTraversalException instead of touching the file
 *   system.
 * - Atomic writes: contents land in a uniquely named temporary file in the
 *   destination directory and are renamed into place, so a concurrent
 *   reader never observes a half-written file (same technique as the
 *   file session store).
 *
 * Mirrors Laravel's Illuminate\Filesystem\LocalFilesystemAdapter.
 */

import type { Dirent, Stats } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Str } from '@/Support/Str';
import type { FilesystemAdapter, WriteOptions } from './Contracts/FilesystemAdapter';
import { FileNotFoundException } from './FileNotFoundException';
import { PathTraversalException } from './PathTraversalException';

export interface LocalAdapterConfig {
  /** Absolute or relative root the disk is jailed to */
  root: string;
  /** Public URL prefix served by the web server; url() throws when unset */
  url?: string | null;
}

export class LocalFilesystemAdapter implements FilesystemAdapter {
  protected root: string;
  protected urlPrefix?: string;

  constructor(config: LocalAdapterConfig) {
    this.root = path.resolve(config.root);

    if (config.url) {
      this.urlPrefix = String(config.url).replace(/\/+$/, '');
    }
  }

  async get(filePath: string): Promise<Buffer | null> {
    const local = this.localPath(filePath);

    try {
      return await fs.readFile(local);
    } catch {
      return null;
    }
  }

  async put(filePath: string, contents: string | Buffer, _options?: WriteOptions): Promise<boolean> {
    const local = this.localPath(filePath);

    try {
      await fs.mkdir(path.dirname(local), { recursive: true });

      // Atomic write: fill a temp file in the same directory and rename it
      // over the target, which is atomic on POSIX filesystems
      const temp = `${local}.${process.pid}.${Str.random(8)}.tmp`;

      try {
        await fs.writeFile(temp, contents);
        await fs.rename(temp, local);
        return true;
      } catch (error) {
        await fs.rm(temp, { force: true }).catch(() => undefined);
        throw error;
      }
    } catch {
      return false;
    }
  }

  async exists(filePath: string): Promise<boolean> {
    const local = this.localPath(filePath);

    try {
      await fs.stat(local);
      return true;
    } catch {
      return false;
    }
  }

  async delete(filePath: string): Promise<boolean> {
    const local = this.localPath(filePath);

    try {
      await fs.unlink(local);
      return true;
    } catch {
      return false;
    }
  }

  async copy(source: string, destination: string): Promise<boolean> {
    const from = this.localPath(source);
    const to = this.localPath(destination);

    try {
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.copyFile(from, to);
      return true;
    } catch {
      return false;
    }
  }

  async move(source: string, destination: string): Promise<boolean> {
    const from = this.localPath(source);
    const to = this.localPath(destination);

    try {
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.rename(from, to);
      return true;
    } catch {
      return false;
    }
  }

  async size(filePath: string): Promise<number> {
    return (await this.statOrThrow(filePath)).size;
  }

  async lastModified(filePath: string): Promise<number> {
    return Math.floor((await this.statOrThrow(filePath)).mtimeMs / 1000);
  }

  async listFiles(directory: string, recursive: boolean): Promise<string[]> {
    return (await this.listContents(directory, recursive)).filter((entry) => entry.type === 'file').map(toPath);
  }

  async listDirectories(directory: string, recursive: boolean): Promise<string[]> {
    return (await this.listContents(directory, recursive))
      .filter((entry) => entry.type === 'dir')
      .map(toPath)
      .sort((a, b) => a.length - b.length);
  }

  async makeDirectory(directory: string): Promise<boolean> {
    const local = this.localPath(directory);

    try {
      await fs.mkdir(local, { recursive: true });
      return true;
    } catch {
      return false;
    }
  }

  async deleteDirectory(directory: string): Promise<boolean> {
    const local = this.localPath(directory);

    try {
      await fs.rm(local, { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  }

  url(filePath: string): string {
    const normalized = this.assertSafeKey(filePath);

    if (!this.urlPrefix) {
      throw new Error(
        'This disk does not support generating public URLs because none has been configured. ' +
          'Set the "url" option on the disk (the public disk uses /storage by default).'
      );
    }

    return `${this.urlPrefix}/${normalized}`;
  }

  path(filePath: string): string {
    return this.localPath(filePath);
  }

  /**
   * Entries below a directory, each carrying its disk-relative slash path
   */
  protected async listContents(directory: string, recursive: boolean): Promise<Array<ContentsEntry>> {
    const base = this.localPath(directory);

    const collected: Array<ContentsEntry> = [];
    const queue: string[] = [];

    if (await this.isDirectory(base)) {
      queue.push(base);
    }

    while (queue.length > 0) {
      const current = queue.shift();

      if (current === undefined) {
        break;
      }

      let entries: Dirent[];

      try {
        entries = await fs.readdir(current, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        const child = path.join(current, entry.name);
        const key = this.toDiskPath(child);

        if (entry.isDirectory()) {
          collected.push({ type: 'dir', path: key });

          if (recursive) {
            queue.push(child);
          }
        } else if (entry.isFile()) {
          collected.push({ type: 'file', path: key });
        }
      }
    }

    return collected;
  }

  protected async statOrThrow(filePath: string): Promise<Stats> {
    const local = this.localPath(filePath);

    try {
      return await fs.stat(local);
    } catch (error) {
      throw new FileNotFoundException(String((error as { path?: string }).path ?? local), { cause: error });
    }
  }

  protected async isDirectory(target: string): Promise<boolean> {
    try {
      return (await fs.stat(target)).isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * Absolute local path for a disk-relative key, refusing `..` escapes
   */
  protected localPath(key: string): string {
    const normalized = this.assertSafeKey(key);

    if (normalized === '') {
      return this.root;
    }

    const resolved = path.resolve(this.root, ...normalized.split('/'));

    // Defense in depth: path.resolve collapses `..` before it can escape,
    // so a symlinked root or odd separator still may not leave the jail
    if (resolved !== this.root && !resolved.startsWith(this.root + path.sep)) {
      throw new PathTraversalException(key);
    }

    return resolved;
  }

  /**
   * Normalise a disk-relative key and reject any `..` segment
   */
  protected assertSafeKey(key: string): string {
    const normalized = this.normalizeKey(key);

    if (normalized.split('/').some((segment) => segment === '..')) {
      throw new PathTraversalException(key);
    }

    return normalized;
  }

  /**
   * Strip leading slashes and normalise separators without touching `..`
   * (assertSafeKey rejects those explicitly)
   */
  protected normalizeKey(key: string): string {
    return String(key ?? '')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '');
  }

  /**
   * Disk-relative slash path for an absolute local path
   */
  protected toDiskPath(local: string): string {
    return path.relative(this.root, local).split(path.sep).join('/');
  }
}

interface ContentsEntry {
  type: 'file' | 'dir';
  path: string;
}

function toPath(entry: ContentsEntry): string {
  return entry.path;
}
