/**
 * Translation loader contract - the seam between storage and translation
 * Illuminate\Contracts\Translation\Loader
 *
 * The Translator owns key resolution, replacement and pluralization; a
 * loader owns turning `(locale, namespace, group)` into raw lines from
 * *somewhere* (Laravel ships a FileLoader for PHP files; this port adds
 * JSON files and nested object/TS modules). New formats plug into the
 * Translator by implementing this interface - the translator itself is
 * never edited (OCP).
 */

/**
 * A tree of translation lines: nested objects flatten into dot keys, so
 * `{ required: '...' }` under the `validation` group answers
 * `validation.required`.
 */
export type TranslationLines = Record<string, any>;

export interface TranslationLoader {
  /**
   * Resolve the raw lines for one group of a locale. JSON files are read
   * synchronously; nested object/TS modules load through a dynamic import,
   * so a loader may hand back a promise - the Translator adopts the lines
   * when it resolves and can be asked to `preload` a locale up front.
   * Returning `null` means "no lines for this group".
   */
  load(locale: string, namespace: string, group: string): TranslationLines | Promise<TranslationLines | null> | null;

  /**
   * Optional: the locales the loader can serve (used by the
   * Accept-Language middleware to select a supported locale).
   */
  locales?(): string[];

  /**
   * Optional: the group names available for a locale (used by
   * Translator#preload to warm module-based lines up front).
   */
  groups?(locale: string): string[];

  /**
   * Optional: point a package namespace (`package::file.key`) at a
   * directory holding its language files.
   */
  addNamespace?(namespace: string, path: string): void;

  /**
   * Optional: register an extra directory scanned for flat
   * `{locale}.json` files (top-level keys, the '*' group).
   */
  addJsonPath?(path: string): void;
}
