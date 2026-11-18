/**
 * TranslationServiceProvider
 *
 * Binds the Translator into the container under 'translator', wiring a
 * FileLoader over the application's `lang/` directory and applying the
 * `app.locale` / `app.fallback_locale` configuration. Boot awaits a
 * preload of both locales so nested object / TS language modules are
 * ready for the synchronous lookups `__()`, validation messages and
 * other framework internals perform afterwards.
 *
 * Laravel: Illuminate\Translation\TranslationServiceProvider
 *
 * @example
 * ```typescript
 * app.register(TranslationServiceProvider);
 * await app.boot(); // reads config('app.locale')
 * ```
 */

import type { Config as ConfigClass } from '@/Foundation/Config/Config';
import { ServiceProvider } from '@/Foundation/ServiceProvider';
import { FileLoader } from './FileLoader';
import { Translator } from './Translator';

export class TranslationServiceProvider extends ServiceProvider {
  register(): void {
    this.app.singleton('translator', () => {
      const loader = new FileLoader([this.app.langPath()]);

      return new Translator(
        loader,
        this.configValue('app.locale', 'en'),
        this.configValue('app.fallback_locale', 'en')
      );
    });
  }

  async boot(): Promise<void> {
    const translator = this.app.make<Translator>('translator');

    translator.setLocale(this.configValue('app.locale', translator.getLocale()));
    translator.setFallback(this.configValue('app.fallback_locale', translator.getFallback()));

    // Warm the active and fallback locales: JSON lines load lazily and
    // synchronously, module files need their import awaited up front.
    await translator.preload(translator.getLocale());

    if (translator.getFallback() !== translator.getLocale()) {
      await translator.preload(translator.getFallback());
    }
  }

  /**
   * The services provided by this provider
   */
  provides(): string[] {
    return ['translator'];
  }

  /**
   * Read one string config value, tolerating apps that boot without a
   * config repository.
   */
  private configValue(key: string, defaultValue: string): string {
    if (!this.app.bound('config')) {
      return defaultValue;
    }

    const value = this.app.make<ConfigClass>('config').get<string>(key);

    return typeof value === 'string' && value !== '' ? value : defaultValue;
  }
}
