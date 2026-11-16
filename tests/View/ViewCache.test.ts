import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { CommandOptions } from '@/Console/Command';
import type { TemplateAst } from '@/View/Compilers/Ast';
import { ViewCacheCommand } from '@/Console/Commands/ViewCacheCommand';
import { ViewClearCommand } from '@/Console/Commands/ViewClearCommand';
import { Application } from '@/Foundation/Application';
import { ViewCache } from '@/View/Compilers/ViewCache';
import { CompilerEngine } from '@/View/Engines/CompilerEngine';
import { ViewFactory } from '@/View/ViewFactory';

function listCacheFiles(dir: string): string[] {
  return existsSync(dir) && statSync(dir).isDirectory() ? readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
}

describe('ViewCache', () => {
  const dir = join(tmpdir(), `orchestr-viewcache-${process.pid}-${Date.now()}`);

  beforeEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips an AST keyed by path and source hash', () => {
    const cache = new ViewCache(dir);
    const ast: TemplateAst = [{ type: 'text', value: 'hi' }];

    expect(cache.get('/views/a.html', 'source v1')).toBeNull();

    cache.put('/views/a.html', 'source v1', ast);
    expect(cache.get('/views/a.html', 'source v1')).toEqual(ast);
  });

  it('invalidates entries when the source changes', () => {
    const cache = new ViewCache(dir);
    cache.put('/views/a.html', 'original', [{ type: 'text', value: 'old' }]);
    cache.put('/views/a.html', 'changed', [{ type: 'text', value: 'new' }]);

    const entry = JSON.parse(readFileSync(cache.pathFor('/views/a.html'), 'utf8'));
    expect(entry.ast).toEqual([{ type: 'text', value: 'new' }]);
  });

  it('treats corrupt cache files as a miss', () => {
    const cache = new ViewCache(dir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(cache.pathFor('/views/a.html'), 'not-json{{{', 'utf8');

    expect(cache.get('/views/a.html', 'anything')).toBeNull();
  });

  it('flush removes every compiled entry', () => {
    const cache = new ViewCache(dir);
    cache.put('/views/a.html', 'a', []);
    cache.put('/views/b.html', 'b', []);
    expect(listCacheFiles(dir)).toHaveLength(2);

    expect(cache.flush()).toBe(2);
    expect(listCacheFiles(dir)).toHaveLength(0);
  });
});

describe('compiled view cache invalidation (engine level)', () => {
  const base = join(tmpdir(), `orchestr-viewengine-cache-${process.pid}-${Date.now()}`);
  const viewsDir = join(base, 'views');
  const cacheDir = join(base, 'framework/views');
  let engine: CompilerEngine;
  let factory: ViewFactory;
  let viewFile: string;

  beforeEach(() => {
    rmSync(base, { recursive: true, force: true });
    mkdirSync(viewsDir, { recursive: true });
    engine = new CompilerEngine({ cache: new ViewCache(cacheDir) });
    factory = new ViewFactory(engine, [viewsDir]);
    engine.setResolver(factory);
    viewFile = join(viewsDir, 'counter.html');
  });

  it('writes compiled templates to disk and serves later renders from cache', async () => {
    writeFileSync(viewFile, 'v1: {{ x }}', 'utf8');
    expect(await factory.make('counter', { x: 7 }).render()).toBe('v1: 7');
    expect(listCacheFiles(cacheDir)).toHaveLength(1);

    // The compiled artifact is the parse tree, not the output: the second
    // render with new data must still work off the cached AST.
    expect(await factory.make('counter', { x: 9 }).render()).toBe('v1: 9');
  });

  it('recompiles when the view source changes (hash invalidation)', async () => {
    writeFileSync(viewFile, 'v1: {{ x }}', 'utf8');
    await factory.make('counter').render();
    expect(listCacheFiles(cacheDir)).toHaveLength(1);

    writeFileSync(viewFile, 'v2: {{ x }}!', 'utf8');
    expect(await factory.make('counter', { x: 1 }).render()).toBe('v2: 1!');

    // And the persisted entry reflects the new source hash.
    expect(await factory.make('counter', { x: 2 }).render()).toBe('v2: 2!');
  });

  it('works without a cache at all', async () => {
    const plain = new CompilerEngine();
    const plainFactory = new ViewFactory(plain, [viewsDir]);
    plain.setResolver(plainFactory);
    writeFileSync(viewFile, 'plain {{ x }}', 'utf8');

    expect(await plainFactory.make('counter', { x: '!' }).render()).toBe('plain !');
    expect(listCacheFiles(cacheDir)).toHaveLength(0);
  });
});

describe('view:cache / view:clear commands', () => {
  const base = join(tmpdir(), `orchestr-view-commands-${process.pid}-${Date.now()}`);
  const viewsDir = join(base, 'resources/views');
  let app: Application;
  let engine: CompilerEngine;
  let factory: ViewFactory;
  let cacheDir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let logs: string[];

  beforeEach(() => {
    rmSync(base, { recursive: true, force: true });
    mkdirSync(join(viewsDir, 'partials'), { recursive: true });
    writeFileSync(join(viewsDir, 'index.html'), "@include('partials.header')<h1>{{ title }}</h1>");
    writeFileSync(join(viewsDir, 'partials', 'header.html'), '<header>Header</header>');

    cacheDir = join(base, 'storage/framework/views');
    engine = new CompilerEngine({ cache: new ViewCache(cacheDir) });
    factory = new ViewFactory(engine, [viewsDir]);
    engine.setResolver(factory);

    app = new Application(base);
    app.instance('view', factory);

    logs = [];
    logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(base, { recursive: true, force: true });
  });

  const options: CommandOptions = {};

  it('view:cache compiles every template into the cache directory', async () => {
    expect(listCacheFiles(cacheDir)).toHaveLength(0);

    await new ViewCacheCommand(app).handle([], options);

    const output = logs.join('\n');
    expect(output).toContain('compiled and cached successfully');
    expect(output).toContain('Compiled 2 templates');
    expect(listCacheFiles(cacheDir)).toHaveLength(2);

    // Rendering afterwards proves the primed cache is valid and complete.
    const html = await factory.make('index', { title: 'Go' }).render();
    expect(html).toContain('<h1>Go</h1>');
  });

  it('view:clear deletes the compiled files', async () => {
    await new ViewCacheCommand(app).handle([], options);
    expect(listCacheFiles(cacheDir)).toHaveLength(2);

    logs = [];
    await new ViewClearCommand(app).handle([], options);

    expect(logs.join('\n')).toContain('Compiled views cleared!');
    expect(logs.join('\n')).toContain('Removed 2 cache files');
    expect(listCacheFiles(cacheDir)).toHaveLength(0);

    // Views still render (they recompile on demand).
    expect(await factory.make('index', { title: 'Again' }).render()).toContain('<h1>Again</h1>');
  });

  it('commands report a helpful error without the view service', async () => {
    const bare = new Application(base);

    await new ViewCacheCommand(bare).handle([], options);
    await new ViewClearCommand(bare).handle([], options);

    expect(logs.join('\n')).toContain('view service is not registered');
  });
});
