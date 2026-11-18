/**
 * lang:publish - copies the framework's default language files
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LangPublishCommand } from '@/Console/Commands/LangPublishCommand';
import { ConsoleKernel } from '@/Console/ConsoleKernel';
import { Application } from '@/Foundation/Application';
import { Config } from '@/Foundation/Config/Config';

describe('LangPublishCommand', () => {
  let directory: string;
  let app: Application;
  let command: LangPublishCommand;

  beforeEach(() => {
    // Inside the repo so the "published" TS module stays importable by the
    // test runner in the compile-round-trip spec.
    directory = mkdtempSync(join(process.cwd(), 'tests/Translation/.tmp-lang-'));
    app = new Application(directory);
    command = new LangPublishCommand(app);
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('copies the default validation and attributes files for the app locale', async () => {
    await command.handle([], {});

    const validationPath = join(directory, 'lang/en/validation.ts');
    const attributesPath = join(directory, 'lang/en/attributes.ts');

    expect(existsSync(validationPath)).toBe(true);
    expect(existsSync(attributesPath)).toBe(true);

    const validation = readFileSync(validationPath, 'utf-8');

    expect(validation).toContain('export default {');
    expect(validation).toContain("required: 'The :attribute field is required.',");
    expect(validation).toContain('min: {');
    expect(validation).toContain("string: 'The :attribute must be at least :min characters.',");
    expect(readFileSync(attributesPath, 'utf-8')).toContain('export default {};');
  });

  it('publishes config-driven locales when none are requested', async () => {
    app.instance('config', new Config({ app: { locale: 'fr', fallback_locale: 'de' } }));

    await command.handle([], {});

    expect(existsSync(join(directory, 'lang/fr/validation.ts'))).toBe(true);
    expect(existsSync(join(directory, 'lang/de/validation.ts'))).toBe(true);
    expect(existsSync(join(directory, 'lang/en/validation.ts'))).toBe(false);
  });

  it('honors explicit --locale values', async () => {
    await command.handle([], { locale: ['nl'] });

    expect(existsSync(join(directory, 'lang/nl/validation.ts'))).toBe(true);
    expect(existsSync(join(directory, 'lang/en/validation.ts'))).toBe(false);
  });

  it('keeps existing files unless --force is given', async () => {
    await command.handle([], {});

    const target = join(directory, 'lang/en/validation.ts');

    writeFileSync(target, 'export default { required: "edited by the app" };', 'utf-8');

    await command.handle([], {});

    expect(readFileSync(target, 'utf-8')).toContain('edited by the app');

    await command.handle([], { force: true });

    expect(readFileSync(target, 'utf-8')).toContain('The :attribute field is required.');
  });

  it('writes source that compiles to the shipped default lines', async () => {
    await command.handle([], {});

    const published = await import(join(directory, 'lang/en/validation.ts'));

    expect(published.default.required).toBe('The :attribute field is required.');
    expect(published.default.min.string).toBe('The :attribute must be at least :min characters.');
    expect(published.default.custom).toBeUndefined();
  });

  it('is registered through the console kernel', async () => {
    const kernel = new (class extends ConsoleKernel {
      protected registerCommands(): void {
        this.register(new LangPublishCommand(this.app));
      }
    })(app);

    await kernel.handle('lang:publish', [], {});

    expect(existsSync(join(directory, 'lang/en/validation.ts'))).toBe(true);
  });
});
