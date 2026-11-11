/**
 * FilesystemServiceProvider
 *
 * Binds the FilesystemManager into the container under 'filesystem',
 * assembling its configuration from the `filesystems` config section with
 * Laravel-style defaults. Register it after the ConfigServiceProvider so
 * configured values win:
 *
 * Laravel: Illuminate\Filesystem\FilesystemServiceProvider
 *
 * @example
 * ```typescript
 * app.instance('config', new Config({ filesystems: { default: 'public' } }));
 * app.register(FilesystemServiceProvider);
 *
 * await Storage.disk('local').put('file.txt', 'contents');
 * ```
 */

import type { FilesystemConfig } from '@/Filesystem/FilesystemManager';
import type { Config as ConfigClass } from '@/Foundation/Config/Config';
import { FilesystemManager } from '@/Filesystem/FilesystemManager';
import { ServiceProvider } from '@/Foundation/ServiceProvider';

export class FilesystemServiceProvider extends ServiceProvider {
  register(): void {
    this.app.singleton('filesystem', () => new FilesystemManager(this.getConfig(), this.app.getBasePath()));
  }

  /**
   * The services provided by this provider
   */
  provides(): string[] {
    return ['filesystem'];
  }

  /**
   * Pull the raw `filesystems` configuration out of the config repository
   */
  protected getConfig(): Partial<FilesystemConfig> {
    const configService = this.configService();

    if (!configService) {
      return {};
    }

    const section = configService.get('filesystems');

    return section && typeof section === 'object' ? (section as Partial<FilesystemConfig>) : {};
  }

  /**
   * Resolve the config repository when the ConfigServiceProvider registered
   * one
   */
  protected configService(): ConfigClass | null {
    try {
      return this.app.bound('config') ? this.app.make<ConfigClass>('config') : null;
    } catch {
      return null;
    }
  }
}
