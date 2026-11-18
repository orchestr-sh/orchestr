/**
 * LangPublishCommand
 *
 * Copy the framework's default language files (validation messages and
 * attribute names) into the application's `lang/{locale}` directory so
 * they can be edited and translated, mirroring Laravel 12's
 * `php artisan lang:publish`. Existing files are kept unless `--force`.
 *
 * The published content comes from the same default line modules the
 * framework ships (`src/Translation/lang/en/*`), serialized to
 * `export default {...}` source - one source of truth for the defaults
 * (DRY).
 */

import { existsSync } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { Config as ConfigClass } from '@/Foundation/Config/Config';
import { Command, CommandOptions } from '@/Console/Command';
import { Application } from '@/Foundation/Application';
import { defaultAttributeLines } from '@/Translation/lang/en/attributes';
import { defaultValidationLines } from '@/Translation/lang/en/validation';

/**
 * One publishable language file: its name and the default lines behind it.
 */
interface LanguageFile {
  file: string;
  title: string;
  description: string;
  lines: Record<string, any>;
}

const LANGUAGE_FILES: LanguageFile[] = [
  {
    file: 'validation.ts',
    title: 'Validation Language Lines',
    description:
      'Messages the Validator resolves for failed rules (validation.{rule}, validation.custom.{field}.{rule}). Size-based rules carry file/string/numeric/array variants.',
    lines: defaultValidationLines,
  },
  {
    file: 'attributes.ts',
    title: 'Attribute Language Lines',
    description:
      'Human-readable attribute names interpolated into validation messages (attributes.{field}); unlisted fields fall back to their underscore-split names.',
    lines: defaultAttributeLines,
  },
];

export class LangPublishCommand extends Command {
  signature =
    'lang:publish {--locale* : One or more locales to publish (defaults to app.locale and app.fallback_locale)}' +
    ' {--force : Overwrite language files that already exist}';
  description = 'Publish the default language files to the application lang directory';

  constructor(protected app: Application) {
    super();
  }

  async handle(_args: string[], options: CommandOptions): Promise<void> {
    const locales = this.localesToPublish(options);
    const force = Boolean(options.force);

    for (const locale of locales) {
      const directory = path.join(this.app.langPath(), locale);

      await fs.mkdir(directory, { recursive: true });

      for (const language of LANGUAGE_FILES) {
        const target = path.join(directory, language.file);

        if (existsSync(target) && !force) {
          this.comment(`Skipped [lang/${locale}/${language.file}] - already exists (use --force to overwrite).`);
          continue;
        }

        await fs.writeFile(target, this.toSource(language), 'utf-8');
        this.info(`Language file published: ${target}`);
      }
    }

    this.success('Language files published successfully.');
  }

  /**
   * The `{--locale*}` entries when given, otherwise the configured locale
   * and its fallback (deduplicated).
   */
  private localesToPublish(options: CommandOptions): string[] {
    const requested = options.locale;

    if (Array.isArray(requested) && requested.length > 0) {
      return [...new Set(requested.map(String))];
    }

    if (typeof requested === 'string' && requested !== '') {
      return [requested];
    }

    const config = this.app.bound('config') ? this.app.make<ConfigClass>('config') : null;
    const locale = config?.get<string>('app.locale') ?? 'en';
    const fallback = config?.get<string>('app.fallback_locale') ?? 'en';

    return [...new Set([locale, fallback])];
  }

  /**
   * Render one language file: a documented `export default` of the
   * framework's default lines.
   */
  private toSource(language: LanguageFile): string {
    const header = [
      '/**',
      ` * ${language.title}`,
      ' *',
      ` * ${language.description}`,
      ' *',
      ' * Published by `npx orchestr lang:publish`; edit freely - the',
      ' * translator reads this file from the lang/ directory.',
      ' */',
    ].join('\n');

    return `${header}\n\nexport default ${serializeLines(language.lines, 0)};\n`;
  }
}

/**
 * Serialize a plain line tree into readable TypeScript source.
 */
function serializeLines(value: any, indent: number): string {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '[]';
    }

    const pad = ' '.repeat(indent + 2);

    return `[\n${value.map((item) => `${pad}${serializeLines(item, indent + 2)}`).join(',\n')}\n${' '.repeat(indent)}]`;
  }

  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value);

    if (entries.length === 0) {
      return '{}';
    }

    const pad = ' '.repeat(indent + 2);

    const body = entries.map(([key, item]) => `${pad}${quoteKey(key)}: ${serializeLines(item, indent + 2)}`);

    return `{\n${body.join(',\n')}\n${' '.repeat(indent)}}`;
  }

  return quoteString(value);
}

/**
 * Serialize a string value, preferring single quotes (the published
 * files read like hand-written code) and falling back to JSON escaping
 * for anything containing quotes or backslashes.
 */
function quoteString(value: unknown): string {
  if (typeof value !== 'string' || value.includes("'") || value.includes('\\')) {
    return JSON.stringify(value);
  }

  return `'${value}'`;
}

/**
 * Bare identifiers stay unquoted; anything else becomes a JSON string key.
 */
function quoteKey(key: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? key : JSON.stringify(key);
}
