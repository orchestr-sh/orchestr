/**
 * ViewFactory - Resolves view names and creates View instances.
 *
 * Mirrors Laravel's Illuminate\View\Factory
 */

import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import type { CustomDirectiveHandler } from './Engines/CompilerEngine';
import type { ViewEngine, ViewResolver } from './Engines/ViewEngine';
import { View } from './View';

/** Callback registered through `View.composer` / `View.creator`. */
export type ViewComposerCallback = (view: View, data: Record<string, any>) => void | Promise<void>;

interface ComposerBinding {
  patterns: string[];
  callback: ViewComposerCallback;
}

/** Structural view of the features ViewFactory needs from a compiler engine. */
interface CompilerCapableEngine extends ViewEngine {
  registerDirective?(name: string, handler: CustomDirectiveHandler): void;
  compileFile?(path: string): unknown;
  flushCompiled?(): number;
}

export class ViewFactory implements ViewResolver {
  protected paths: string[];
  protected extensions: string[];
  protected engine: ViewEngine;
  protected shared: Record<string, any> = {};
  protected composers: ComposerBinding[] = [];
  protected creators: ComposerBinding[] = [];

  constructor(engine: ViewEngine, paths: string[], extensions: string[] = ['.html', '.orchestr.html']) {
    this.engine = engine;
    this.paths = paths;
    this.extensions = extensions;
  }

  /**
   * Create a new view instance.
   * Laravel: view('welcome', ['key' => 'value'])
   */
  make(view: string, data: Record<string, any> = {}): View {
    const path = this.findView(view);
    const mergedData = { ...this.shared, ...data };
    const instance = new View(this.engine, view, path, mergedData, this);

    // Creators fire once, at creation time (Laravel: Factory::callCreator).
    for (const binding of this.creators) {
      if (this.bindingMatches(binding, view)) {
        void binding.callback(instance, instance.getData());
      }
    }

    return instance;
  }

  /**
   * Get the rendered contents of the first view that exists in the list.
   * Laravel: View::first(['admin.welcome', 'welcome'])
   */
  first(views: string[], data: Record<string, any> = {}): View {
    const found = views.find((name) => this.exists(name));

    if (found === undefined) {
      throw new Error(`None of the views [${views.join(', ')}] exist.`);
    }

    return this.make(found, data);
  }

  /**
   * Determine if a given view exists.
   * Laravel: View::exists('welcome')
   */
  exists(view: string): boolean {
    try {
      this.findView(view);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Add a piece of shared data to the environment.
   * Laravel: View::share('key', 'value')
   */
  share(key: string | Record<string, any>, value?: any): void {
    if (typeof key === 'string') {
      this.shared[key] = value;
    } else {
      Object.assign(this.shared, key);
    }
  }

  /**
   * Register a custom directive handler.
   * Laravel: Blade::directive('php', fn) / View::directive in 3rd-party engines
   */
  directive(name: string, handler: CustomDirectiveHandler): void {
    const engine = this.engine as CompilerCapableEngine;
    if (typeof engine.registerDirective !== 'function') {
      throw new Error('The active view engine does not support custom directives.');
    }
    engine.registerDirective(name, handler);
  }

  /**
   * Register a view composer, called every time a matching view renders.
   * Patterns support the `*` wildcard: `View.composer('posts.*', fn)`.
   * Laravel: View::composer(['posts.*'], fn)
   */
  composer(views: string | string[], callback: ViewComposerCallback): void {
    this.composers.push({ patterns: Array.isArray(views) ? views : [views], callback });
  }

  /**
   * Register a view creator, called once when a matching view instance is
   * created (not on subsequent renders).
   * Laravel: View::creator('albums.all', fn)
   */
  creator(views: string | string[], callback: ViewComposerCallback): void {
    this.creators.push({ patterns: Array.isArray(views) ? views : [views], callback });
  }

  /**
   * Run every composer matching the view's name; awaited by View::render().
   */
  async callComposers(view: View): Promise<void> {
    for (const binding of this.composers) {
      if (this.bindingMatches(binding, view.name())) {
        await binding.callback(view, view.getData());
      }
    }
  }

  /**
   * Add a location to the array of view paths.
   * Laravel: View::addLocation('/path/to/views')
   */
  addLocation(path: string): void {
    this.paths.push(path);
  }

  /**
   * Get all registered view paths.
   */
  getPaths(): string[] {
    return this.paths;
  }

  /**
   * Get all shared data.
   */
  getShared(): Record<string, any> {
    return this.shared;
  }

  /**
   * The underlying template engine.
   */
  getEngine(): ViewEngine {
    return this.engine;
  }

  /**
   * Compile every view file in the registered locations into the compiled
   * view cache. Used by the `view:cache` command.
   * Laravel: artisan view:cache
   *
   * @returns the number of templates compiled
   */
  compileAll(): number {
    const engine = this.engine as CompilerCapableEngine;
    if (typeof engine.compileFile !== 'function') {
      throw new Error('The active view engine does not support ahead-of-time compilation.');
    }

    let compiled = 0;
    for (const basePath of this.paths) {
      if (!existsSync(basePath)) {
        continue;
      }
      for (const file of this.walk(basePath)) {
        if (this.extensions.some((ext) => file.endsWith(ext))) {
          engine.compileFile(file);
          compiled++;
        }
      }
    }
    return compiled;
  }

  /**
   * Remove all compiled view files. Used by the `view:clear` command.
   * Laravel: artisan view:clear
   *
   * @returns the number of cache entries deleted
   */
  clearCompiled(): number {
    const engine = this.engine as CompilerCapableEngine;
    if (typeof engine.flushCompiled === 'function') {
      return engine.flushCompiled();
    }
    return 0;
  }

  /**
   * Resolve a dot-notation view name to an absolute file path.
   *
   * 'welcome'        -> {path}/welcome.html
   * 'layouts.app'   -> {path}/layouts/app.html
   * 'emails.invoice' -> {path}/emails/invoice.html
   *
   * Implements ViewResolver so engines can use it for @include, @extends,
   * @each and @component resolution.
   */
  findView(name: string): string {
    // Convert dot notation to directory separator
    const relativePath = name.replace(/\./g, '/');

    for (const basePath of this.paths) {
      for (const ext of this.extensions) {
        const fullPath = join(basePath, relativePath + ext);
        if (existsSync(fullPath)) {
          return fullPath;
        }
      }
    }

    throw new Error(
      `View [${name}] not found. Searched in: ${this.paths.join(', ')} ` +
        `with extensions: ${this.extensions.join(', ')}`
    );
  }

  /**
   * Whether a composer/creator binding matches a view name. `*` is a
   * wildcard; comparison is case-insensitive, like Laravel's
   * Factory::bindingsMatch.
   */
  protected bindingMatches(binding: ComposerBinding, view: string): boolean {
    const name = view.toLowerCase();
    return binding.patterns.some((pattern) => this.patternMatches(pattern.toLowerCase(), name));
  }

  protected patternMatches(pattern: string, name: string): boolean {
    if (pattern === '*') {
      return true;
    }
    if (!pattern.includes('*')) {
      return pattern === name;
    }
    const regex = new RegExp(`^${pattern.split('*').map(escapeRegExp).join('.*')}$`);
    return regex.test(name);
  }

  /** Recursively list files under a directory. */
  protected *walk(dir: string): Generator<string> {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      let stats;
      try {
        stats = statSync(full);
      } catch {
        continue;
      }
      if (stats.isDirectory()) {
        yield* this.walk(full);
      } else if (stats.isFile()) {
        yield full;
      }
    }
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
