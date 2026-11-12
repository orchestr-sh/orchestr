import { readFileSync } from 'fs';
import { DotenvParser } from './DotenvParser';

/**
 * Env
 *
 * Environment access for the framework, mirroring Laravel's
 * `Illuminate\Support\Env` plus the `env()` helper semantics:
 *
 * - `Env.load(path)` parses a dotenv file into the process environment.
 * - Values already present in `process.env` are never overwritten by default,
 *   so the real environment always wins over the file (as in Laravel).
 * - Files loaded by `Env.load` are tracked; a later file (e.g. `.env.production`)
 *   may replace a value an earlier file (`.env`) wrote, but still never
 *   replaces a variable that was set by the host environment.
 * - `Env.get()` applies Laravel's string coercion: `true`, `false`, `null`
 *   and `empty` (including the parenthesised forms) become their real
 *   values, keeping quotes out of the way of config code.
 */
export class Env {
  /**
   * Raw values this class has written into `process.env`, used to decide
   * whether a later `.env` file may replace an existing entry.
   */
  private static loaded: Map<string, string> = new Map();

  /**
   * Load a dotenv file into the process environment.
   *
   * Missing files are ignored (safe-load semantics) so `.env` is optional.
   * When `overwrite` is true, existing process environment variables are
   * replaced; by default they are left untouched.
   *
   * @returns the values that were applied
   */
  static load(path: string, overwrite: boolean = false): Record<string, string> {
    let content: string;

    try {
      content = readFileSync(path, 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return {};
      }

      throw error;
    }

    return Env.hydrate(DotenvParser.parse(content), overwrite);
  }

  /**
   * Apply parsed entries into the process environment.
   */
  private static hydrate(parsed: Record<string, string>, overwrite: boolean): Record<string, string> {
    const applied: Record<string, string> = {};

    for (const [key, value] of Object.entries(parsed)) {
      const exists = process.env[key] !== undefined;

      if (exists && !overwrite && !Env.loaded.has(key)) {
        continue;
      }

      process.env[key] = value;
      Env.loaded.set(key, value);
      applied[key] = value;
    }

    return applied;
  }

  /**
   * Get an environment variable with Laravel's `env()` coercion applied.
   * Without a default the result may be undefined; with one it can't.
   */
  static get(key: string): string | boolean | null | undefined;
  static get<T = any>(key: string, defaultValue: T): T | string | boolean | null;
  static get<T = any>(key: string, defaultValue?: T): T | string | boolean | null | undefined {
    const raw = process.env[key];

    if (raw === undefined) {
      return defaultValue;
    }

    switch (raw.toLowerCase()) {
      case 'true':
      case '(true)':
        return true;
      case 'false':
      case '(false)':
        return false;
      case 'null':
      case '(null)':
        return null;
      case 'empty':
      case '(empty)':
        return '';
      default:
        return raw as string;
    }
  }

  /**
   * Determine if an environment variable is defined.
   */
  static has(key: string): boolean {
    return process.env[key] !== undefined;
  }

  /**
   * Put a value into the environment. Booleans/null round-trip through the
   * `env()` coercion; `undefined` removes the variable.
   */
  static set(key: string, value: string | number | bigint | boolean | null | undefined): void {
    if (value === undefined) {
      Env.forget(key);
      return;
    }

    let raw: string;

    if (value === null) {
      raw = 'null';
    } else if (value === true) {
      raw = 'true';
    } else if (value === false) {
      raw = 'false';
    } else {
      raw = String(value);
    }

    process.env[key] = raw;
    Env.loaded.set(key, raw);
  }

  /**
   * Remove a variable from the environment and the loaded registry.
   */
  static forget(key: string): void {
    delete process.env[key];
    Env.loaded.delete(key);
  }

  /**
   * Parse dotenv-formatted contents without touching the environment.
   * Exposed for tests and tooling (e.g. deploy `env:push`).
   */
  static parse(content: string): Record<string, string> {
    return DotenvParser.parse(content);
  }
}
