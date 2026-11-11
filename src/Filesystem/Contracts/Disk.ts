/**
 * Disk Contract
 *
 * The caller-facing storage API. `UploadedFile::store()` and every
 * application call site program against this interface, never against a
 * concrete driver, so swapping local for S3 later requires no caller
 * changes (OCP).
 *
 * Mirrors Laravel's Illuminate\Contracts\Filesystem\Filesystem.
 */

import type { WriteOptions } from './FilesystemAdapter';

export type { WriteOptions };

/**
 * Anything a disk can hash-name and write. Laravel's FilesystemAdapter
 * accepts an Illuminate\Http\UploadedFile here; this port uses the shape
 * instead of the class so drivers stay independent of the HTTP layer.
 */
export interface Uploadable {
  /**
   * A random, collision-resistant name keeping the upload's extension
   * Laravel: UploadedFile::hashName()
   */
  hashName(): string;

  /**
   * The upload's bytes
   */
  get(): Promise<Buffer>;

  /**
   * The media type reported by the client
   */
  getClientMimeType(): string;
}

export interface Disk {
  /**
   * Write a file at an explicit path
   */
  put(path: string, contents: string | Buffer, options?: WriteOptions): Promise<boolean>;

  /**
   * Store an upload under a hash-generated name inside a directory and
   * return its path (false when the write fails)
   * Laravel: FilesystemAdapter::putFile()
   */
  putFile(directory: string, file: Uploadable, options?: WriteOptions): Promise<string | false>;

  /**
   * Store an upload under an explicit name inside a directory and return
   * its path (false when the write fails)
   * Laravel: FilesystemAdapter::putFileAs()
   */
  putFileAs(directory: string, file: Uploadable, name: string, options?: WriteOptions): Promise<string | false>;

  /**
   * Read a file's raw contents, or null when it does not exist
   */
  get(path: string): Promise<Buffer | null>;

  /**
   * Determine whether a file exists
   */
  exists(path: string): Promise<boolean>;

  /**
   * Determine whether a file is missing
   */
  missing(path: string): Promise<boolean>;

  /**
   * Delete one or many files
   */
  delete(path: string | string[]): Promise<boolean>;

  /**
   * Copy a file within the disk
   */
  copy(source: string, destination: string): Promise<boolean>;

  /**
   * Move (rename) a file within the disk
   */
  move(source: string, destination: string): Promise<boolean>;

  /**
   * File size in bytes
   */
  size(path: string): Promise<number>;

  /**
   * Last modification time as a unix timestamp in seconds
   */
  lastModified(path: string): Promise<number>;

  /**
   * The files in a directory, excluding directories
   */
  files(directory?: string): Promise<string[]>;

  /**
   * Every file on the disk, nested included
   */
  allFiles(): Promise<string[]>;

  /**
   * The directories in a directory, excluding files
   */
  directories(directory?: string): Promise<string[]>;

  /**
   * Every directory on the disk, nested included
   */
  allDirectories(): Promise<string[]>;

  /**
   * Create a directory (including missing parents)
   */
  makeDirectory(directory: string): Promise<boolean>;

  /**
   * Delete a directory and everything below it
   */
  deleteDirectory(directory: string): Promise<boolean>;

  /**
   * The public URL for a stored path
   */
  url(path: string, options?: WriteOptions): string;

  /**
   * The disk's local representation of a path
   */
  path(path: string): string;

  /**
   * A time-limited URL for a path
   */
  temporaryUrl(path: string, expiration: Date | number, options?: WriteOptions): Promise<string>;
}
