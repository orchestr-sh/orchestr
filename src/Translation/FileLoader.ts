/**
 * FileLoader - language lines from disk
 * Illuminate\Translation\FileLoader
 *
 * Turns `(locale, namespace, group)` into lines from two file shapes:
 *
 * - `{path}/{locale}/{group}.json` - read synchronously, so lazily
 *   requested keys work without any warm-up
 * - `{path}/{locale}/{group}.ts` / `.js` modules default-exporting a
 *   nested object (`lang/en/validation.ts` -> `validation.required`);
 *   Node can only import modules asynchronously, so the loader hands the
 *   Translator a promise that it adopts when settled - `preload()` and
 *   the service provider's boot await it
 * - flat `{path}/{locale}.json` files answer top-level keys (the '*'
 *   group), mirroring Laravel's JSON translations
 *
 * Package language files (`package::file.key`) live under paths
 * registered with `addNamespace`; application lines under the paths the
 * loader was constructed with. Import results are memoized per file, so
 * repeated lazy lookups never re-import (DRY).
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { basename, extname, join } from 'path';
import { pathToFileURL } from 'url';
import type { TranslationLines, TranslationLoader } from './Contracts/TranslationLoader';

/**
 * Module extensions probed for nested object / TS language files.
 */
const MODULE_EXTENSIONS = ['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs'];

/**
 * Loose guard for directory names that hold a locale's lines
 * (`en`, `fr_CA`, `pt-BR`, ...); anything else inside a lang root is ignored.
 */
const LOCALE_PATTERN = /^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]+)*$/;

export class FileLoader implements TranslationLoader {
  private paths: string[];

  private jsonPaths: string[] = [];

  private hints: Map<string, string[]> = new Map();

  /** Memoized module imports keyed by absolute file path. */
  private modules: Map<string, Promise<TranslationLines | null>> = new Map();

  constructor(paths: string[] = []) {
    this.paths = [...paths];
  }

  /**
   * Register another application language root.
   */
  addPath(path: string): this {
    this.paths.push(path);
    return this;
  }

  /**
   * Register a directory scanned for flat `{locale}.json` files.
   * Laravel: FileLoader::addJsonPath()
   */
  addJsonPath(path: string): void {
    this.jsonPaths.push(path);
  }

  /**
   * Point a package namespace at its language directory so
   * `package::file.key` resolves there. Laravel: FileLoader::addNamespace()
   */
  addNamespace(namespace: string, path: string): void {
    const registered = this.hints.get(namespace) ?? [];

    registered.push(path);
    this.hints.set(namespace, registered);
  }

  /**
   * Resolve the lines for one group of a locale; may return a promise for
   * module files (see the TranslationLoader contract).
   */
  load(locale: string, namespace: string, group: string): TranslationLines | Promise<TranslationLines | null> | null {
    for (const base of this.searchPaths(namespace)) {
      const json = join(base, locale, `${group}.json`);

      if (existsSync(json)) {
        return this.readJson(json);
      }

      for (const extension of MODULE_EXTENSIONS) {
        const module = join(base, locale, `${group}${extension}`);

        if (existsSync(module)) {
          return this.importModule(module);
        }
      }
    }

    // Top-level keys come from flat {path}/{locale}.json files
    if (group === '*') {
      for (const base of [...this.jsonPaths, ...this.paths, ...this.allHintPaths()]) {
        const flat = join(base, `${locale}.json`);

        if (existsSync(flat)) {
          return this.readJson(flat);
        }
      }
    }

    return null;
  }

  /**
   * The locales available across the registered roots: directories with
   * language files, plus locales with a flat `{locale}.json`.
   */
  locales(): string[] {
    const found = new Set<string>();

    for (const base of [...this.paths, ...this.allHintPaths()]) {
      if (!this.isDirectory(base)) {
        continue;
      }

      for (const entry of readdirSync(base, { withFileTypes: true })) {
        if (entry.isDirectory() && LOCALE_PATTERN.test(entry.name)) {
          found.add(entry.name);
        } else if (entry.isFile() && extname(entry.name) === '.json') {
          const locale = basename(entry.name, '.json');

          if (LOCALE_PATTERN.test(locale)) {
            found.add(locale);
          }
        }
      }
    }

    return [...found].sort((left, right) => left.localeCompare(right));
  }

  /**
   * The group names available for one locale across the application
   * roots, including '*' when a flat `{locale}.json` exists. Used by
   * Translator#preload to warm module-based lines.
   */
  groups(locale: string): string[] {
    const groups = new Set<string>();

    for (const base of this.paths) {
      const directory = join(base, locale);

      if (this.isDirectory(directory)) {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
          if (entry.isFile() && (extname(entry.name) === '.json' || MODULE_EXTENSIONS.includes(extname(entry.name)))) {
            groups.add(basename(entry.name, extname(entry.name)));
          }
        }
      }

      if (existsSync(join(base, `${locale}.json`))) {
        groups.add('*');
      }
    }

    return [...groups];
  }

  /**
   * Paths searched for a namespace: hint registrations for packages, the
   * application roots for the '*' namespace.
   */
  private searchPaths(namespace: string): string[] {
    return namespace === '*' ? this.paths : [...(this.hints.get(namespace) ?? [])];
  }

  private allHintPaths(): string[] {
    return [...this.hints.values()].flat();
  }

  /**
   * Read and parse one JSON language file.
   */
  private readJson(file: string): TranslationLines {
    try {
      return JSON.parse(readFileSync(file, 'utf-8'));
    } catch (error) {
      throw new Error(`Failed to load translation file [${file}].`, { cause: error });
    }
  }

  /**
   * Import one nested object / TS language module, memoizing the promise
   * so concurrent lookups share a single import.
   */
  private importModule(file: string): Promise<TranslationLines | null> {
    const cached = this.modules.get(file);

    if (cached !== undefined) {
      return cached;
    }

    const pending = import(pathToFileURL(file).href)
      .then((module: any) => {
        if (module === null || module === undefined || typeof module !== 'object') {
          return null;
        }

        const lines = 'default' in module ? module.default : module;

        return lines !== null && typeof lines === 'object' ? (lines as TranslationLines) : null;
      })
      .catch(() => null);

    this.modules.set(file, pending);

    return pending;
  }

  private isDirectory(path: string): boolean {
    return existsSync(path) && readdirSyncSafe(path) !== null;
  }
}

/**
 * readdirSync that answers null instead of throwing when the path is not
 * a readable directory (e.g. a file shadowing a locale name).
 */
function readdirSyncSafe(path: string): string[] | null {
  try {
    return readdirSync(path);
  } catch {
    return null;
  }
}
