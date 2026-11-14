/**
 * Service provider stub.
 *
 * Laravel: Illuminate\Foundation\Console\ProviderMakeCommand.
 */
export default `/**
 * {{ class }}
 *
 * Namespace: {{ namespace }}
 */

import { ServiceProvider } from '@orchestr-sh/orchestr';

export class {{ class }} extends ServiceProvider {
  /**
   * Register any application services.
   */
  register(): void {
    // Bind into the container, e.g.:
    // this.app.instance('parser', new OrderParser());
  }

  /**
   * Bootstrap any application services.
   */
  boot(): void {
    // Runs after every provider has registered.
  }
}
`;
