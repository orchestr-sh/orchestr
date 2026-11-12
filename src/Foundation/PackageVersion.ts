/**
 * Package version resolution
 *
 * Reads the framework version from this package's own `package.json` instead
 * of a hard-coded string, mirroring Laravel's single `Application::VERSION`
 * constant while keeping `package.json` as the single source of truth.
 */

import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';

const PACKAGE_NAME = '@orchestr-sh/orchestr';

let cached: string | undefined;

/**
 * Walk up from `startDir` (the current working directory by default) until a
 * `package.json` belonging to this package is found. Returns the version
 * string, or "unknown" when running outside the package tree (e.g. cwd is an
 * application that installed the framework as a dependency).
 */
export function packageVersion(startDir: string = process.cwd()): string {
  if (startDir === process.cwd()) {
    if (cached === undefined) {
      cached = lookup(startDir);
    }

    return cached;
  }

  return lookup(startDir);
}

function lookup(startDir: string): string {
  let dir = startDir;

  for (;;) {
    const candidate = join(dir, 'package.json');

    if (existsSync(candidate)) {
      try {
        const pkg = JSON.parse(readFileSync(candidate, 'utf-8'));

        if (pkg.name === PACKAGE_NAME && typeof pkg.version === 'string') {
          return pkg.version;
        }
      } catch {
        // Unreadable or malformed package.json: keep walking up.
      }
    }

    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }

    dir = parent;
  }

  return 'unknown';
}
