/**
 * ViewServiceProvider
 *
 * Registers view services into the container.
 * Mirrors Laravel's Illuminate\View\ViewServiceProvider
 */

import { join } from 'path';
import { ServiceProvider } from '@/Foundation/ServiceProvider';
import { ViewFactory } from './ViewFactory';
import { TemplateEngine } from './Engines/TemplateEngine';

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
}

export class ViewServiceProvider extends ServiceProvider {
  /**
   * Register view services
   */
  register(): void {
    this.app.singleton('view', () => {
      const config = this.getConfig();

      const engine = new TemplateEngine();
      const factory = new ViewFactory(engine, config.paths, config.extensions);

      // Wire the engine back to the factory so @include / @extends work
      engine.setResolver(factory);

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
        };
      }
    } catch {
      // Config service not available yet
    }

    return {
      paths: [join(basePath, 'resources/views')],
      extensions: ['.html', '.orchestr.html'],
    };
  }
}
