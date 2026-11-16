/**
 * ViewEngine - Contract for template engines
 *
 * Mirrors Laravel's Illuminate\View\Engines\EngineInterface
 */

export interface ViewEngine {
  /**
   * Get the evaluated contents of the view.
   */
  get(path: string, data: Record<string, any>): Promise<string>;
}

/**
 * Dependency injection shim so engines can resolve included/extended view
 * names to file paths without a circular import with ViewFactory.
 */
export interface ViewResolver {
  findView(name: string): string;
}
