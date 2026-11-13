import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'fs';
import { basename, dirname, extname, join } from 'path';
import { pathToFileURL } from 'url';
import type { Application } from '../Application';

/**
 * ConfigLoader
 *
 * The single place where configuration *sources* are turned into repository
 * items (Laravel splits this between LoadConfiguration and the cache
 * commands; the SRP boundary here is "loading", not the repository itself).
 *
 * Sources, in order of preference:
 * 1. The cached snapshot (`bootstrap/cache/config.json`, overridable via the
 *    `APP_CONFIG_CACHE` environment variable) when it exists.
 * 2. The `config/` directory: `*.ts`, `*.js`, and `*.json` files at the top
 *    level, keyed by file basename (`config/database.ts` -> `database`).
 */
export class ConfigLoader {
  private static readonly extensions = ['.ts', '.js', '.json'];

  constructor(private app: Application) {}

  /**
   * Load configuration from the cache when present, otherwise from files.
   */
  async load(): Promise<Record<string, any>> {
    if (this.app.configurationIsCached()) {
      return this.loadCached();
    }

    return this.loadFiles();
  }

  /**
   * Read every supported configuration file from the config directory.
   */
  async loadFiles(): Promise<Record<string, any>> {
    const directory = this.app.configPath();

    if (!existsSync(directory)) {
      return {};
    }

    const entries = readdirSync(directory, { withFileTypes: true });
    const items: Record<string, any> = {};

    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isFile() || !ConfigLoader.extensions.includes(extname(entry.name))) {
        continue;
      }

      const key = basename(entry.name, extname(entry.name));
      items[key] = await this.readFile(join(directory, entry.name));
    }

    return items;
  }

  /**
   * Read the cached configuration snapshot, returning an empty record when
   * the file is missing (it may have been cleared concurrently).
   */
  loadCached(): Record<string, any> {
    const path = this.app.getCachedConfigPath();

    if (!existsSync(path)) {
      return {};
    }

    try {
      return JSON.parse(readFileSync(path, 'utf-8'));
    } catch (error) {
      throw new Error(`The configuration cache [${path}] is not valid JSON.`, { cause: error });
    }
  }

  /**
   * Write a serializable snapshot of the given items to the cache path and
   * return the path written.
   */
  cache(items: Record<string, any>): string {
    const nonSerializable = ConfigLoader.findUnserializable(items);

    if (nonSerializable.length > 0) {
      throw new Error(
        `Unable to cache configuration. The following values are not serializable: ${nonSerializable.join(', ')}.`
      );
    }

    let json: string;

    try {
      json = JSON.stringify(items, null, 2);
    } catch (error) {
      throw new Error('Unable to cache configuration. The configuration contains circular references.', {
        cause: error,
      });
    }

    const path = this.app.getCachedConfigPath();

    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, json + '\n', 'utf-8');

    return path;
  }

  /**
   * Remove the cached snapshot. Returns true when a file was deleted.
   */
  clearCache(): boolean {
    const path = this.app.getCachedConfigPath();

    if (!existsSync(path)) {
      return false;
    }

    unlinkSync(path);

    return true;
  }

  /**
   * Load a single configuration file. JSON files are parsed; JS/TS files are
   * imported and use their default export when present.
   */
  private async readFile(filePath: string): Promise<any> {
    if (filePath.endsWith('.json')) {
      try {
        return JSON.parse(readFileSync(filePath, 'utf-8'));
      } catch (error) {
        throw new Error(`Failed to parse configuration file [${filePath}].`, { cause: error });
      }
    }

    try {
      const module = await import(pathToFileURL(filePath).href);

      return module && typeof module === 'object' && 'default' in module ? module.default : module;
    } catch (error) {
      throw new Error(`Failed to load configuration file [${filePath}].`, { cause: error });
    }
  }

  /**
   * Collect dot-notation paths whose values JSON cannot represent
   * (functions, symbols, bigints) so `cache()` can fail loudly instead of
   * silently dropping them, like Laravel's serialization check.
   */
  private static findUnserializable(items: unknown, prefix: string[] = []): string[] {
    const found: string[] = [];

    if (Array.isArray(items)) {
      items.forEach((value, index) => {
        found.push(...ConfigLoader.findUnserializable(value, [...prefix, String(index)]));
      });

      return found;
    }

    if (items !== null && typeof items === 'object') {
      for (const [key, value] of Object.entries(items)) {
        found.push(...ConfigLoader.findUnserializable(value, [...prefix, key]));
      }

      return found;
    }

    if (typeof items === 'function' || typeof items === 'symbol' || typeof items === 'bigint') {
      found.push(prefix.join('.'));
    }

    return found;
  }
}
