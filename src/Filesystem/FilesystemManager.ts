/**
 * FilesystemManager
 *
 * Builds disks from configuration and keeps one instance per disk name.
 * Ships the three drivers every Laravel app starts with - `local`,
 * `public` and `null` - and `extend()` registers new drivers (S3 and
 * friends) without touching this class or any caller (OCP).
 *
 * Mirrors Laravel's Illuminate\Filesystem\FilesystemManager.
 *
 * @example
 * ```typescript
 * const manager = new FilesystemManager({
 *   default: 'local',
 *   disks: {
 *     local: { driver: 'local', root: '/var/www/app/storage/app' },
 *     public: { driver: 'local', root: '/var/www/app/storage/app/public', url: '/storage' },
 *   },
 * }, '/var/www/app');
 *
 * const disk = manager.disk('public');
 * await disk.put('avatars/photo.png', buffer);
 * disk.url('avatars/photo.png'); // '/storage/avatars/photo.png'
 * ```
 */

import { isAbsolute } from 'path';
import type { Disk, Uploadable } from './Contracts/Disk';
import type { FilesystemAdapter, WriteOptions } from './Contracts/FilesystemAdapter';
import { FilesystemDisk } from './FilesystemDisk';
import { LocalFilesystemAdapter } from './LocalFilesystemAdapter';
import { NullFilesystemAdapter } from './NullFilesystemAdapter';

/**
 * One `disks` entry per Laravel config/filesystems.php disk
 */
export interface DiskConfig {
  /** Driver name resolved through the manager's factory table */
  driver: string;
  /** Disk root, relative to the application base path or absolute */
  root?: string;
  /** Public URL prefix for url(); unset means the disk has no URLs */
  url?: string | null;
  [key: string]: any;
}

export interface FilesystemConfig {
  /** Default disk name */
  default: string;
  /** Disk definitions keyed by disk name */
  disks: Record<string, DiskConfig>;
}

/**
 * A filesystem driver factory: builds the adapter from its disk config
 */
export type FilesystemDriverFactory = (config: DiskConfig, name: string) => FilesystemAdapter;

/**
 * Default configuration merged under whatever the app provides, mirroring
 * Laravel's config/filesystems.php disk table
 */
export const FILESYSTEM_DEFAULTS: FilesystemConfig = {
  default: 'local',
  disks: {
    local: { driver: 'local', root: 'storage/app' },
    public: { driver: 'local', root: 'storage/app/public', url: '/storage' },
    null: { driver: 'null' },
  },
};

export class FilesystemManager {
  public readonly config: FilesystemConfig;

  /**
   * Lazily built disks, keyed by disk name
   */
  protected disks: Map<string, FilesystemDisk> = new Map();

  /**
   * Registered driver factories, seeded with the built-in local/null pair
   */
  protected drivers: Map<string, FilesystemDriverFactory> = new Map();

  /**
   * Base path relative disk roots resolve against (the application path)
   */
  protected basePath: string;

  constructor(config: Partial<FilesystemConfig> = {}, basePath: string = process.cwd()) {
    this.config = {
      default: config.default ?? FILESYSTEM_DEFAULTS.default,
      disks: { ...FILESYSTEM_DEFAULTS.disks, ...(config.disks ?? {}) },
    };

    this.basePath = basePath;

    this.registerDriver('local', (diskConfig) => new LocalFilesystemAdapter(this.localAdapterConfig(diskConfig)));
    this.registerDriver('null', () => new NullFilesystemAdapter());
  }

  /**
   * Register a filesystem driver factory
   * Laravel: FilesystemManager::extend()
   */
  extend(name: string, factory: FilesystemDriverFactory): this {
    this.registerDriver(name, factory);
    return this;
  }

  /**
   * Alias of extend for symmetry with CacheManager
   */
  registerDriver(name: string, factory: FilesystemDriverFactory): void {
    this.drivers.set(name, factory);

    // Replace any disk already built from the previous definition
    for (const [diskName, disk] of this.disks) {
      if (this.config.disks[diskName]?.driver === name) {
        this.disks.delete(diskName);
      }
    }
  }

  /**
   * The default disk name
   * Laravel: FilesystemManager::getDefaultDriver()
   */
  getDefaultDriver(): string {
    return this.config.default;
  }

  /**
   * Set the default disk name
   */
  setDefaultDriver(name: string): void {
    this.config.default = name;
  }

  /**
   * All configured disk names
   */
  getDiskNames(): string[] {
    return Object.keys(this.config.disks);
  }

  /**
   * Resolve a disk by name, defaulting to the configured disk
   * Laravel: FilesystemManager::disk()
   */
  disk(name?: string): FilesystemDisk {
    const diskName = name ?? this.config.default;

    const cached = this.disks.get(diskName);

    if (cached) {
      return cached;
    }

    const disk = this.createDisk(diskName);
    this.disks.set(diskName, disk);

    return disk;
  }

  /**
   * Drop a cached disk instance so the next disk() call rebuilds it
   */
  purge(name?: string): void {
    this.disks.delete(name ?? this.config.default);
  }

  /**
   * Drop every cached disk instance
   */
  purgeAll(): void {
    this.disks.clear();
  }

  // --- Proxy methods to the default disk for convenience ---
  // Laravel: FilesystemManager::__call() forwarding to disk()

  put(path: string, contents: string | Buffer, options?: WriteOptions): Promise<boolean> {
    return this.disk().put(path, contents, options);
  }

  putFile(directory: string, file: Uploadable, options?: WriteOptions): Promise<string | false> {
    return this.disk().putFile(directory, file, options);
  }

  putFileAs(directory: string, file: Uploadable, name: string, options?: WriteOptions): Promise<string | false> {
    return this.disk().putFileAs(directory, file, name, options);
  }

  get(path: string): Promise<Buffer | null> {
    return this.disk().get(path);
  }

  exists(path: string): Promise<boolean> {
    return this.disk().exists(path);
  }

  missing(path: string): Promise<boolean> {
    return this.disk().missing(path);
  }

  delete(path: string | string[]): Promise<boolean> {
    return this.disk().delete(path);
  }

  copy(source: string, destination: string): Promise<boolean> {
    return this.disk().copy(source, destination);
  }

  move(source: string, destination: string): Promise<boolean> {
    return this.disk().move(source, destination);
  }

  size(path: string): Promise<number> {
    return this.disk().size(path);
  }

  lastModified(path: string): Promise<number> {
    return this.disk().lastModified(path);
  }

  files(directory?: string): Promise<string[]> {
    return this.disk().files(directory);
  }

  allFiles(): Promise<string[]> {
    return this.disk().allFiles();
  }

  directories(directory?: string): Promise<string[]> {
    return this.disk().directories(directory);
  }

  allDirectories(): Promise<string[]> {
    return this.disk().allDirectories();
  }

  makeDirectory(directory: string): Promise<boolean> {
    return this.disk().makeDirectory(directory);
  }

  deleteDirectory(directory: string): Promise<boolean> {
    return this.disk().deleteDirectory(directory);
  }

  url(path: string, options?: WriteOptions): string {
    return this.disk().url(path, options);
  }

  path(path: string): string {
    return this.disk().path(path);
  }

  temporaryUrl(path: string, expiration: Date | number, options?: WriteOptions): Promise<string> {
    return this.disk().temporaryUrl(path, expiration, options);
  }

  /**
   * Build a disk from its configuration entry
   */
  protected createDisk(name: string): FilesystemDisk {
    const diskConfig = this.config.disks[name];

    if (!diskConfig) {
      throw new Error(`Disk [${name}] is not defined. Available disks: ${this.getDiskNames().join(', ')}.`);
    }

    const factory = this.drivers.get(diskConfig.driver);

    if (!factory) {
      throw new Error(
        `Filesystem driver [${diskConfig.driver}] is not supported. ` +
          `Available drivers: ${Array.from(this.drivers.keys()).join(', ')}.`
      );
    }

    return new FilesystemDisk(name, factory(diskConfig, name));
  }

  /**
   * Roots arrive disk-configured; relative ones land under the app's
   * storage area, absolute ones are used as given
   */
  protected localAdapterConfig(diskConfig: DiskConfig): { root: string; url?: string | null } {
    return {
      root: this.resolveRoot(diskConfig.root ?? 'storage/app'),
      url: diskConfig.url ?? null,
    };
  }

  /**
   * Anchor a relative disk root at the application base path
   */
  protected resolveRoot(root: string): string {
    return isAbsolute(root) ? root : `${this.basePath}/${root}`;
  }
}
