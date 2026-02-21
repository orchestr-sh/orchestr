/**
 * View Facade
 *
 * Provides static access to the ViewFactory.
 *
 * @example
 * ```typescript
 * import { View } from '@orchestr-sh/orchestr';
 *
 * // Create a view
 * const v = View.make('welcome', { name: 'John' });
 * const html = await v.render();
 *
 * // Check if a view exists
 * if (View.exists('layouts.app')) { ... }
 *
 * // Share data with all views
 * View.share('appName', 'My App');
 * ```
 */

import { Facade } from '@/Support/Facade';
import type { ViewFactory } from '@/View/ViewFactory';

class ViewFacadeClass extends Facade {
  protected static getFacadeAccessor(): string {
    return 'view';
  }
}

export const View = new Proxy(ViewFacadeClass, {
  get(target, prop) {
    // First check if it's a static method on the facade class itself
    if (prop in target) {
      const value = (target as any)[prop];
      if (typeof value === 'function') {
        return value.bind(target);
      }
      return value;
    }

    // Then proxy to the ViewFactory instance
    try {
      const root = (target as any).getFacadeRoot() as ViewFactory;
      if (root && prop in root) {
        const value = (root as any)[prop];
        if (typeof value === 'function') {
          return (...args: any[]) => value.apply(root, args);
        }
        return value;
      }
    } catch {
      // Facade root not available yet
    }

    return undefined;
  },
}) as unknown as typeof ViewFacadeClass & ViewFactory;
