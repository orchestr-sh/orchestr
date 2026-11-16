/**
 * ViewCache - compiled template cache with source-hash invalidation.
 *
 * Stores parsed TemplateAst trees on disk as JSON, keyed by a hash of the
 * view's absolute path and validated against a hash of the source. Touching
 * a view file changes its hash and transparently recompiles it, so no
 * cache-bust step is required in development; `view:cache` / `view:clear`
 * (see Console commands) prime and flush the directory for deployments.
 *
 * Mirrors Illuminate\View\Compilers\Compiler + Filesystem cache behaviour.
 */

import { createHash } from 'crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { TemplateAst } from './Ast';

interface CachePayload {
  hash: string;
  ast: TemplateAst;
}

function hashOf(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export class ViewCache {
  constructor(private dir: string) {}

  /** The directory compiled views are stored in. */
  getDirectory(): string {
    return this.dir;
  }

  /** The cache file name for a view path. */
  pathFor(viewPath: string): string {
    return join(this.dir, `${hashOf(viewPath)}.json`);
  }

  /**
   * Read a cached AST for `viewPath`, or null when there is no entry or the
   * source hash no longer matches (invalidation on file change).
   */
  get(viewPath: string, source: string): TemplateAst | null {
    const file = this.pathFor(viewPath);
    if (!existsSync(file)) {
      return null;
    }

    try {
      const payload = JSON.parse(readFileSync(file, 'utf8')) as CachePayload;
      if (payload.hash !== hashOf(source) || !Array.isArray(payload.ast)) {
        return null;
      }
      return payload.ast;
    } catch {
      // Corrupt or unreadable entry: treat as a miss; store() will overwrite.
      return null;
    }
  }

  /** Persist the compiled AST for a view path. */
  put(viewPath: string, source: string, ast: TemplateAst): void {
    if (!existsSync(this.dir)) {
      try {
        mkdirSync(this.dir, { recursive: true });
      } catch {
        return; // read-only filesystem: cache stays in-process only
      }
    }

    const payload: CachePayload = { hash: hashOf(source), ast };
    try {
      writeFileSync(this.pathFor(viewPath), JSON.stringify(payload), 'utf8');
    } catch {
      // Disk failures must not break rendering.
    }
  }

  /**
   * Remove every compiled file from the cache directory. Returns the number
   * of entries deleted.
   * Laravel: artisan view:clear
   */
  flush(): number {
    if (!existsSync(this.dir) || !statSync(this.dir).isDirectory()) {
      return 0;
    }

    let removed = 0;
    for (const entry of readdirSync(this.dir)) {
      if (!entry.endsWith('.json')) {
        continue;
      }
      const file = join(this.dir, entry);
      try {
        unlinkSync(file);
        removed++;
      } catch {
        // Ignore files that vanished under us.
      }
    }

    // Leave nothing behind for the `view:clear` contract when the directory
    // only holds cache entries.
    try {
      if (existsSync(this.dir) && readdirSync(this.dir).length === 0) {
        rmSync(this.dir, { recursive: true });
      }
    } catch {
      // Non-fatal.
    }

    return removed;
  }
}
