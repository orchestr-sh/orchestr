/**
 * HttpServiceProvider
 *
 * Binds the HTTP client factory into the container under `http` - the
 * key the Http facade and the http() helper resolve. Like Mail's
 * provider it is a thin configuration shell: the transport lives
 * behind the Factory's Transport contract and can be swapped with
 * `Http.setTransport(...)` without touching the container.
 *
 * Mirrors Laravel's Illuminate\Http\HttpServiceProvider (simplified to
 * the client factory binding the HTTP client actually uses).
 *
 * @example
 * ```typescript
 * app.register(HttpServiceProvider);
 *
 * await http().withToken('secret').get('https://api.example.com/me');
 * ```
 */

import { ServiceProvider } from '@/Foundation/ServiceProvider';
import { Factory } from '@/Http/Client/Factory';

export class HttpServiceProvider extends ServiceProvider {
  register(): void {
    this.app.singleton('http', () => new Factory());
  }

  /**
   * The services provided by this provider
   */
  provides(): string[] {
    return ['http'];
  }
}
