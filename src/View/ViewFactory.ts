/**
 * ViewFactory - Resolves view names and creates View instances.
 *
 * Mirrors Laravel's Illuminate\View\Factory
 */

import { existsSync } from 'fs';
import { join } from 'path';
import type { TemplateEngineResolver } from './Engines/TemplateEngine';
import type { ViewEngine } from './Engines/ViewEngine';
import { View } from './View';

export class ViewFactory implements TemplateEngineResolver {
  protected paths: string[];
  protected extensions: string[];
  protected engine: ViewEngine;
  protected shared: Record<string, any> = {};

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
    return new View(this.engine, view, path, mergedData);
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
   * Resolve a dot-notation view name to an absolute file path.
   *
   * 'welcome'        -> {path}/welcome.html
   * 'layouts.app'   -> {path}/layouts/app.html
   * 'emails.invoice' -> {path}/emails/invoice.html
   *
   * Implements TemplateEngineResolver so the TemplateEngine can use it
   * for @include and @extends resolution.
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
}
