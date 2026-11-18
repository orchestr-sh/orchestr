/**
 * Translation Module - Laravel-shaped localization
 * Illuminate\Translation
 *
 * Translator resolves `package::group.nested.key` lookups through
 * pluggable loaders with a locale fallback chain; FileLoader reads JSON
 * files and nested object/TS modules from `lang/`, Pluralizer selects
 * the `|` form of a choice line, and Replacer interpolates `:name`
 * placeholders. TranslationServiceProvider binds the whole stack as the
 * container's 'translator'; `__()` / `trans()` / `trans_choice()` and
 * the Lang facade are the application-facing entry points.
 */

export type { TranslationLines, TranslationLoader } from './Contracts/TranslationLoader';
export { FileLoader } from './FileLoader';
export { Pluralizer } from './Pluralizer';
export { Replacer } from './Replacer';
export type { ReplacementValues } from './Replacer';
export { Translator, defaultTranslator, parseTranslationKey } from './Translator';
export type { ParsedTranslationKey } from './Translator';
export { TranslationServiceProvider } from './TranslationServiceProvider';
