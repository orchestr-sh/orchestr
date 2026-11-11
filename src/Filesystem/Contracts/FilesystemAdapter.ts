/**
 * FilesystemAdapter Contract
 *
 * The low-level interface every storage driver implements. Disks delegate
 * their operations here, so new drivers (S3, GCS, ...) can be registered on
 * the FilesystemManager without editing any caller (OCP).
 *
 * Mirrors Laravel's Illuminate\Contracts\Filesystem\Filesystem as consumed
 * by the FilesystemManager's driver factories.
 */

/**
 * Optional per-operation write options; drivers that understand them
 * (visibility, metadata) may consume them, local drivers ignore what they
 * do not support.
 */
export type WriteOptions = Record<string, any>;

export interface FilesystemAdapter {
  /**
   * Read a file's raw contents, or null when it does not exist
   */
  get(path: string): Promise<Buffer | null>;

  /**
   * Write a file, creating parent directories as needed
   */
  put(path: string, contents: string | Buffer, options?: WriteOptions): Promise<boolean>;

  /**
   * Determine whether a file exists
   */
  exists(path: string): Promise<boolean>;

  /**
   * Delete a file
   */
  delete(path: string): Promise<boolean>;

  /**
   * Copy a file within the disk
   */
  copy(source: string, destination: string): Promise<boolean>;

  /**
   * Move (rename) a file within the disk
   */
  move(source: string, destination: string): Promise<boolean>;

  /**
   * File size in bytes; throws FileNotFoundException when missing
   */
  size(path: string): Promise<number>;

  /**
   * Last modification time as a unix timestamp in seconds; throws
   * FileNotFoundException when missing
   */
  lastModified(path: string): Promise<number>;

  /**
   * Files inside a directory; recursive walks nested directories and
   * returns disk-relative slash paths
   */
  listFiles(directory: string, recursive: boolean): Promise<string[]>;

  /**
   * Directories inside a directory; recursive walks nested directories and
   * returns disk-relative slash paths
   */
  listDirectories(directory: string, recursive: boolean): Promise<string[]>;

  /**
   * Create a directory (including missing parents)
   */
  makeDirectory(directory: string): Promise<boolean>;

  /**
   * Delete a directory and everything below it
   */
  deleteDirectory(directory: string): Promise<boolean>;

  /**
   * The public URL for a stored path; throws when the driver has no URL
   * configured
   */
  url(path: string): string;

  /**
   * The adapter's local representation of a path (e.g. the full filesystem
   * path for local drivers)
   */
  path(path: string): string;

  /**
   * A time-limited URL for a path. Drivers without signed-URL support omit
   * this member entirely; the disk then rejects the call.
   * Laravel: FilesystemAdapter::temporaryUrl()
   */
  temporaryUrl?(path: string, expiration: Date | number, options?: WriteOptions): string | Promise<string>;
}
