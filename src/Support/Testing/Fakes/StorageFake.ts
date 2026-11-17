/**
 * StorageFake
 *
 * The in-memory test double for the filesystem. `Storage.fake()` (and
 * `TestCase::fakeStorage()`) swap the `filesystem` binding for a manager
 * whose disks are backed by `ArrayFilesystemAdapter`, so writes never touch
 * the real disk and assertions can inspect what the application stored.
 *
 * Mirrors Illuminate\Support\Testing\Fakes\StorageFake and the fake disks
 * created by `Storage::fake()`.
 *
 * @example
 * ```typescript
 * const storage = Storage.fake();
 *
 * await Storage.put('welcome.txt', 'Hello');
 *
 * storage.disk('local').assertExists('welcome.txt');
 * await storage.assertExistsIn('local', 'welcome.txt');
 * await storage.assertMissingIn('local', 'goodbye.txt');
 * ```
 */

import type { FilesystemAdapter, WriteOptions } from '@/Filesystem/Contracts/FilesystemAdapter';
import type { FilesystemConfig } from '@/Filesystem/FilesystemManager';
import { FileNotFoundException } from '@/Filesystem/FileNotFoundException';
import { FilesystemDisk } from '@/Filesystem/FilesystemDisk';
import { FilesystemManager } from '@/Filesystem/FilesystemManager';

/**
 * A stored blob with its fake timestamps
 */
interface StoredFile {
  contents: Buffer;
  lastModified: number;
}

/**
 * Array-backed filesystem adapter: files live in process memory
 */
export class ArrayFilesystemAdapter implements FilesystemAdapter {
  /**
   * Every stored path, normalised to a leading-slash-free relative path
   */
  protected files: Map<string, StoredFile> = new Map();

  /**
   * Explicitly created directories (parents of files are implied)
   */
  protected directories: Set<string> = new Set();

  constructor(
    protected diskName: string = 'local',
    protected baseUrl: string | null = null
  ) {}

  async get(path: string): Promise<Buffer | null> {
    return this.files.get(normalize(path))?.contents ?? null;
  }

  async put(path: string, contents: string | Buffer, _options?: WriteOptions): Promise<boolean> {
    const key = normalize(path);

    this.files.set(key, {
      contents: Buffer.isBuffer(contents) ? contents : Buffer.from(String(contents)),
      lastModified: Math.floor(Date.now() / 1000),
    });

    return true;
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(normalize(path));
  }

  async delete(path: string | string[]): Promise<boolean> {
    const paths = Array.isArray(path) ? path : [path];

    for (const entry of paths) {
      this.files.delete(normalize(entry));
    }

    return true;
  }

  async copy(source: string, destination: string): Promise<boolean> {
    const file = this.files.get(normalize(source));

    if (!file) {
      throw new FileNotFoundException(`File not found at path [${source}].`);
    }

    this.files.set(normalize(destination), { ...file });

    return true;
  }

  async move(source: string, destination: string): Promise<boolean> {
    await this.copy(source, destination);
    this.files.delete(normalize(source));

    return true;
  }

  async size(path: string): Promise<number> {
    const file = this.files.get(normalize(path));

    if (!file) {
      throw new FileNotFoundException(`File not found at path [${path}].`);
    }

    return file.contents.byteLength;
  }

  async lastModified(path: string): Promise<number> {
    const file = this.files.get(normalize(path));

    if (!file) {
      throw new FileNotFoundException(`File not found at path [${path}].`);
    }

    return file.lastModified;
  }

  async listFiles(directory: string, recursive: boolean): Promise<string[]> {
    const prefix = normalize(directory);

    return [...this.files.keys()]
      .filter((key) => withinDirectory(key, prefix, recursive))
      .filter((key) => key !== prefix)
      .sort();
  }

  async listDirectories(directory: string, _recursive: boolean): Promise<string[]> {
    const prefix = normalize(directory);

    const children = new Set<string>();

    for (const key of [...this.files.keys(), ...this.directories]) {
      const relative = prefix === '' ? key : key.startsWith(`${prefix}/`) ? key.slice(prefix.length + 1) : null;

      if (relative === null || !relative.includes('/')) {
        continue;
      }

      children.add(relative.split('/')[0]);
    }

    return [...children].sort();
  }

  async makeDirectory(directory: string): Promise<boolean> {
    this.directories.add(normalize(directory));

    return true;
  }

  async deleteDirectory(directory: string): Promise<boolean> {
    const prefix = normalize(directory);

    for (const key of [...this.files.keys()]) {
      if (key === prefix || key.startsWith(`${prefix}/`)) {
        this.files.delete(key);
      }
    }

    for (const dir of [...this.directories]) {
      if (dir === prefix || dir.startsWith(`${prefix}/`)) {
        this.directories.delete(dir);
      }
    }

    return true;
  }

  url(path: string): string {
    if (!this.baseUrl) {
      throw new Error(`Disk [${this.diskName}] has no URL configured, so urls cannot be generated.`);
    }

    return `${this.baseUrl.replace(/\/+$/, '')}/${normalize(path)}`;
  }

  path(path: string): string {
    return normalize(path);
  }

  /**
   * Whether a path names an existing directory (explicitly created or
   * implied by a stored file)
   */
  isDirectory(path: string): boolean {
    const key = normalize(path);

    if (key === '') {
      return true;
    }

    if (this.directories.has(key)) {
      return true;
    }

    return [...this.files.keys()].some((file) => file.startsWith(`${key}/`));
  }

  /**
   * Every stored path - handy when an assertion needs to explain a miss
   */
  storedPaths(): string[] {
    return [...this.files.keys()].sort();
  }

  /**
   * Forget everything stored on this adapter
   */
  flush(): void {
    this.files.clear();
    this.directories.clear();
  }
}

/**
 * A disk whose adapter is the array store and which knows how to assert on
 * its own contents
 * Laravel: the fake disk returned by Storage::fake()
 */
export class FakeFilesystemDisk extends FilesystemDisk {
  constructor(name: string, adapter: ArrayFilesystemAdapter) {
    super(name, adapter);
  }

  protected arrayAdapter(): ArrayFilesystemAdapter {
    return this.getAdapter() as unknown as ArrayFilesystemAdapter;
  }

  /**
   * Assert the given file(s) exist on this disk
   * Laravel: Storage::fake()->assertExists()
   */
  async assertExists(paths: string | string[]): Promise<void> {
    for (const path of toArray(paths)) {
      if (!(await this.exists(path))) {
        throw new Error(
          `File [${path}] does not exist on disk [${this.name}]. ` +
            `Stored: ${this.arrayAdapter().storedPaths().join(', ') || 'nothing'}.`
        );
      }
    }
  }

  /**
   * Assert the given file(s) are missing from this disk
   */
  async assertMissing(paths: string | string[]): Promise<void> {
    for (const path of toArray(paths)) {
      if (await this.exists(path)) {
        throw new Error(`File [${path}] exists on disk [${this.name}], but it should not.`);
      }
    }
  }

  /**
   * Assert the given directory(ies) exist on this disk
   */
  assertDirectoryExists(paths: string | string[]): void {
    for (const path of toArray(paths)) {
      if (!this.arrayAdapter().isDirectory(path)) {
        throw new Error(`Directory [${path}] does not exist on disk [${this.name}].`);
      }
    }
  }

  /**
   * Assert the given directory(ies) are missing from this disk
   */
  assertDirectoryMissing(paths: string | string[]): void {
    for (const path of toArray(paths)) {
      if (this.arrayAdapter().isDirectory(path)) {
        throw new Error(`Directory [${path}] exists on disk [${this.name}], but it should not.`);
      }
    }
  }

  /**
   * Forget everything stored on the disk
   */
  flush(): void {
    this.arrayAdapter().flush();
  }
}

/**
 * Filesystem manager whose faked disks resolve to in-memory
 * `FakeFilesystemDisk`s; disks not in the faked set keep their real,
 * configuration-driven behaviour exactly like `Storage::fake('disk')`
 * leaves the others alone.
 */
export class FakeFilesystemManager extends FilesystemManager {
  /**
   * Faked disks, keyed by name; created on demand so any named disk
   * resolves to a fake
   */
  protected fakeDisks: Map<string, FakeFilesystemDisk> = new Map();

  /**
   * The disk names answered with a fake; 'all' fakes every disk
   */
  protected readonly fakedNames: Set<string> | 'all';

  constructor(config: Partial<FilesystemConfig> = {}, fakedDisks: string[] | 'all' = 'all') {
    super(config);

    this.fakedNames = fakedDisks === 'all' ? 'all' : new Set(fakedDisks);
  }

  /**
   * Determine whether a disk name is faked by this manager
   */
  isFaked(name?: string): boolean {
    return this.fakedNames === 'all' || this.fakedNames.has(name ?? this.getDefaultDriver());
  }

  /**
   * The fake disk for a faked name (default disk when omitted); disks
   * outside the faked set keep their real implementation
   */
  override disk(name?: string): FilesystemDisk {
    const diskName = name ?? this.getDefaultDriver();

    if (!this.isFaked(diskName)) {
      return super.disk(name);
    }

    const existing = this.fakeDisks.get(diskName);

    if (existing) {
      return existing;
    }

    const url = this.config.disks[diskName]?.url ?? null;
    const disk = new FakeFilesystemDisk(diskName, new ArrayFilesystemAdapter(diskName, url));

    this.fakeDisks.set(diskName, disk);

    return disk;
  }

  /**
   * Every disk that has been resolved while faked
   */
  usedDisks(): FakeFilesystemDisk[] {
    return [...this.fakeDisks.values()];
  }

  /**
   * Every configured disk name
   */
  diskNames(): string[] {
    return Object.keys(this.config.disks);
  }
}

/**
 * A Storage-fake handle: the installed manager plus the Laravel-style
 * cross-disk assertions
 */
export class StorageFake {
  /**
   * The disks faked by this installation
   */
  public readonly disks: Map<string, FakeFilesystemDisk>;

  constructor(
    public readonly manager: FakeFilesystemManager,
    disks: Map<string, FakeFilesystemDisk>
  ) {
    this.disks = disks;
  }

  /**
   * The fake disk for a name
   */
  disk(name?: string): FakeFilesystemDisk {
    return this.manager.disk(name) as FakeFilesystemDisk;
  }

  /**
   * Assert the given file exists on every faked disk
   * Laravel: Storage::assertExists
   */
  async assertExists(paths: string | string[]): Promise<void> {
    for (const disk of this.disks.values()) {
      await disk.assertExists(paths);
    }
  }

  /**
   * Assert the given file is missing from every faked disk
   * Laravel: Storage::assertMissing
   */
  async assertMissing(paths: string | string[]): Promise<void> {
    for (const disk of this.disks.values()) {
      await disk.assertMissing(paths);
    }
  }

  /**
   * Assert the given file exists on one specific disk
   * Laravel: Storage::assertExistsIn
   */
  async assertExistsIn(disk: string, paths: string | string[]): Promise<void> {
    await this.disk(disk).assertExists(paths);
  }

  /**
   * Assert the given file is missing from one specific disk
   * Laravel: Storage::assertMissingIn
   */
  async assertMissingIn(disk: string, paths: string | string[]): Promise<void> {
    await this.disk(disk).assertMissing(paths);
  }

  /**
   * Assert a directory exists on every faked disk
   * Laravel: Storage::assertDirectoryExists
   */
  assertDirectoryExists(paths: string | string[]): void {
    for (const disk of this.disks.values()) {
      disk.assertDirectoryExists(paths);
    }
  }

  /**
   * Assert a directory is missing from every faked disk
   * Laravel: Storage::assertDirectoryMissing
   */
  assertDirectoryMissing(paths: string | string[]): void {
    for (const disk of this.disks.values()) {
      disk.assertDirectoryMissing(paths);
    }
  }

  /**
   * Forget everything stored across the faked disks
   */
  flush(): void {
    for (const disk of this.disks.values()) {
      disk.flush();
    }
  }
}

/**
 * Build the faked manager for an application's filesystems configuration,
 * limiting the faked disks when a subset is named
 */
export function createStorageFake(
  config: Partial<FilesystemConfig>,
  disks?: string | string[]
): { manager: FakeFilesystemManager; fake: StorageFake } {
  const names = disks === undefined ? 'all' : toArray(disks);

  const manager = new FakeFilesystemManager(config, names);

  // Pre-touch the disks so assertions can iterate the faked set even
  // before the application has used them
  const fakedDisks = new Map<string, FakeFilesystemDisk>();

  const targets = names === 'all' ? [...manager.diskNames(), manager.getDefaultDriver()] : names;

  for (const name of new Set(targets)) {
    fakedDisks.set(name, manager.disk(name) as FakeFilesystemDisk);
  }

  return { manager, fake: new StorageFake(manager, fakedDisks) };
}

/**
 * Normalise a storage path: no leading/trailing slashes
 */
function normalize(path: string): string {
  return String(path).replace(/^\/+|\/+$/g, '');
}

/**
 * Whether a stored path lives in a directory (recursively or just below it)
 */
function withinDirectory(key: string, prefix: string, recursive: boolean): boolean {
  if (prefix === '') {
    return true;
  }

  if (!key.startsWith(`${prefix}/`)) {
    return false;
  }

  return recursive || !key.slice(prefix.length + 1).includes('/');
}

/**
 * Accept a single value or an array of them
 */
function toArray(value: string | string[]): string[] {
  return Array.isArray(value) ? value : [value];
}
