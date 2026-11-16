/**
 * StorageLinkCommand
 *
 * Create the conventional `public/storage` symlink pointing at the public
 * disk's root (by default `storage/app/public`) so files written through
 * `Storage.disk('public')` become web-accessible. Mirrors Laravel's
 * `php artisan storage:link`.
 *
 * The target comes from the registered FilesystemManager when present, so
 * custom disk roots are respected; the symlink itself is plain filesystem
 * plumbing. Re-running is a no-op; replacing a different (or broken) link is
 * destructive and goes through the confirmToProceed gate.
 */

import { existsSync, lstatSync, mkdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, unlinkSync } from 'fs';
import { dirname } from 'path';
import type { FilesystemManager } from '@/Filesystem/FilesystemManager';
import { Command, CommandOptions } from '@/Console/Command';
import { FILESYSTEM_DEFAULTS } from '@/Filesystem/FilesystemManager';
import { Application } from '@/Foundation/Application';

/** The disk the public web directory links to, Laravel's convention. */
const PUBLIC_DISK = 'public';

export class StorageLinkCommand extends Command {
  signature = 'storage:link {--force : Replace an existing link that points elsewhere}';
  description = 'Create a symbolic link for the public disk';

  constructor(protected app: Application) {
    super();
  }

  async handle(_args: string[] = [], options: CommandOptions = {}): Promise<void> {
    const target = this.publicDiskRoot();
    const link = this.app.publicPath('storage');

    if (!existsSync(target)) {
      this.error(`The [${target}] directory does not exist.`);
      return;
    }

    if (this.linkPointsTo(link, target)) {
      this.info('Storage link already exists.');
      return;
    }

    const existing = lstatSync(link, { throwIfNoEntry: false });

    if (existing !== undefined) {
      if (
        !(await this.confirmToProceed(
          options,
          `The [${link}] path already exists. Replace it with a link to [${target}]?`
        ))
      ) {
        this.comment('Storage link cancelled.');
        return;
      }

      // Dangling symlinks survive `rmSync` (it resolves the path first), so
      // links are unlinked directly; real files/directories recurse.
      if (existing.isSymbolicLink()) {
        unlinkSync(link);
      } else {
        rmSync(link, { recursive: true, force: true });
      }
    }

    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(target, link, 'dir');

    this.info('Storage link created successfully.');
    this.newLine();
    this.comment(`${link} -> ${target}`);
  }

  /**
   * The public disk's absolute root, resolved through the registered
   * filesystem manager when the app has one.
   */
  private publicDiskRoot(): string {
    if (this.app.bound('filesystem')) {
      return this.app.make<FilesystemManager>('filesystem').disk(PUBLIC_DISK).path('');
    }

    const root = FILESYSTEM_DEFAULTS.disks[PUBLIC_DISK].root ?? 'storage/app/public';

    return this.app.getBasePath() + '/' + root;
  }

  /**
   * True when `link` is already a symlink resolving to `target`.
   */
  private linkPointsTo(link: string, target: string): boolean {
    const stat = lstatSync(link, { throwIfNoEntry: false });

    if (stat === undefined || !stat.isSymbolicLink()) {
      return false;
    }

    const destination = readlinkSync(link);

    return destination === target || (existsSync(link) && realpathSync(link) === realpathSync(target));
  }
}
