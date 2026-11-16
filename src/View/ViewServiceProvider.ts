/**
 * ViewServiceProvider
 *
 * Registers view services into the container.
 * Mirrors Laravel's Illuminate\View\ViewServiceProvider
 */

import { join } from 'path';
import { ServiceProvider } from '@/Foundation/ServiceProvider';
import { csrf_token } from '@/Support/helpers';
import { ViewCache } from './Compilers/ViewCache';
import { CompilerEngine } from './Engines/CompilerEngine';
import { ViewFactory } from './ViewFactory';

export interface ViewConfig {
  /**
   * Paths to search for view files.
   * Defaults to [{basePath}/resources/views]
   */
  paths?: string[];

  /**
   * File extensions to try, in order.
   * Defaults to ['.html', '.orchestr.html']
   */
  extensions?: string[];

  /**
   * Where compiled templates are cached.
   * Defaults to [{basePath}/storage/framework/views]
   */
  cachePath?: string;

  /**
   * Disable the compiled-view cache entirely (useful in development/tests).
   * Defaults to true.
   */
  cache?: boolean;
}

export class ViewServiceProvider extends ServiceProvider {
  /**
   * Register view services
   */
  register(): void {
    this.app.singleton('view', () => {
      const config = this.getConfig();

      const engine = new CompilerEngine({
        cache: config.cache ? new ViewCache(config.cachePath) : null,
      });
      const factory = new ViewFactory(engine, config.paths, config.extensions);

      // Wire the engine back to the factory so @include / @extends / @each /
      // @component resolve names, and @csrf can reach the session token.
      engine.setResolver(factory);
      engine.setCsrfTokenResolver(() => {
        try {
          return csrf_token();
        } catch {
          return '';
        }
      });

      return factory;
    });
  }

  /**
   * Get the view configuration
   */
  protected getConfig(): Required<ViewConfig> {
    const basePath = this.app.getBasePath();

    try {
      const configService = this.app.make('config') as any;
      const viewConfig = configService?.items?.view || configService?.get?.('view');

      if (viewConfig) {
        return {
          paths: viewConfig.paths ?? [join(basePath, 'resources/views')],
          extensions: viewConfig.extensions ?? ['.html', '.orchestr.html'],
          cachePath: viewConfig.cachePath ?? viewConfig.cache_path ?? join(basePath, 'storage/framework/views'),
          cache: viewConfig.cache ?? true,
        };
      }
    } catch {
      // Config service not available yet
    }

    return {
      paths: [join(basePath, 'resources/views')],
      extensions: ['.html', '.orchestr.html'],
      cachePath: join(basePath, 'storage/framework/views'),
      cache: true,
    };
  }
}
