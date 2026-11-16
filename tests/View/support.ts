/**
 * Shared helpers for the View test suites: a temp views directory, a
 * CompilerEngine wired to a ViewFactory, and an optional disk cache.
 */

import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { ViewCache } from '@/View/Compilers/ViewCache';
import { CompilerEngine } from '@/View/Engines/CompilerEngine';
import { ViewFactory } from '@/View/ViewFactory';

export interface ViewTestSetup {
  /** Root of the temporary views directory. */
  viewsDir: string;
  /** Directory the compiled-view cache is written to. */
  cacheDir: string;
  engine: CompilerEngine;
  factory: ViewFactory;
  /** Write a view file (dot names create directories). */
  put(name: string, content: string): void;
  cleanup(): void;
}

let counter = 0;

export function createViewSetup(options: { cache?: boolean } = {}): ViewTestSetup {
  const base = join(tmpdir(), `orchestr-view-tests-${process.pid}-${Date.now()}-${counter++}`);
  const viewsDir = join(base, 'resources/views');
  const cacheDir = join(base, 'storage/framework/views');
  mkdirSync(viewsDir, { recursive: true });

  const engine = new CompilerEngine({ cache: options.cache === false ? null : new ViewCache(cacheDir) });
  const factory = new ViewFactory(engine, [viewsDir]);
  engine.setResolver(factory);

  return {
    viewsDir,
    cacheDir,
    engine,
    factory,
    put(name: string, content: string): void {
      const file = join(viewsDir, name.replace(/\./g, '/') + '.html');
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, content, 'utf8');
    },
    cleanup(): void {
      rmSync(base, { recursive: true, force: true });
    },
  };
}
