/**
 * Stub
 *
 * The template layer shared by every `make:*` generator. Built-in templates
 * live in `src/Console/stubs` and are addressed by name (`model`, `policy`,
 * `create-table`, ...); applications override any of them by publishing a
 * file with the same name into a `stubs/` directory at the application root
 * (e.g. `stubs/model.stub`), mirroring Laravel's `stub:publish` workflow.
 *
 * Rendering replaces `{{ placeholder }}` tokens with the generator's
 * replacements (`{{ class }}`, `{{ namespace }}`, `{{ table }}`, ...).
 * Unknown tokens are left verbatim so published stubs show their gaps
 * instead of silently generating broken code.
 *
 * Laravel: Illuminate\Console\GeneratorCommand::resolveStubPath + the
 * Illuminate\Support\Stubs\Stub helpers.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { BUILT_IN_STUBS } from '../stubs';

/**
 * Replacements keyed by placeholder name, e.g. `{ class: 'Post' }` feeds
 * the `{{ class }}` token.
 */
export type StubReplacements = Record<string, string>;

/** `{{ name }}` tokens, tolerant of the inner whitespace Laravel allows. */
const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

export class Stub {
  /**
   * Replace `{{ placeholder }}` tokens in a template.
   *
   * Empty replacements can strand trailing whitespace or stacked blank lines
   * where their import statements used to be; Laravel's generated files are
   * clean of both, so the output is normalised the same way and always ends
   * with a single newline.
   */
  static render(template: string, replacements: StubReplacements = {}): string {
    const output = template.replace(PLACEHOLDER, (token: string, key: string) =>
      Object.prototype.hasOwnProperty.call(replacements, key) ? replacements[key] : token
    );

    const cleaned = output.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');

    return cleaned.endsWith('\n') ? cleaned : `${cleaned}\n`;
  }

  /**
   * Load a stub by name, letting published application stubs override the
   * built-in ones.
   *
   * Each `overrideDirs` entry is a directory that may hold a published
   * `<name>.stub`; they are consulted in order before the built-in template
   * from `src/Console/stubs` is used.
   */
  static async load(name: string, ...overrideDirs: Array<string | null | undefined>): Promise<string> {
    for (const dir of overrideDirs) {
      if (typeof dir !== 'string' || dir === '') {
        continue;
      }

      try {
        return await fs.readFile(path.join(dir, `${name}.stub`), 'utf-8');
      } catch {
        // No published override for this stub - try the next source.
      }
    }

    const template = BUILT_IN_STUBS[name];

    if (template === undefined) {
      throw new Error(`Unknown generator stub "${name}". Add it to src/Console/stubs to use it.`);
    }

    return template;
  }
}
