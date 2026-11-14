/**
 * Stub renderer tests
 *
 * Covers placeholder replacement (both `{{ key }}` and `{{key}}` forms),
 * whitespace normalisation after empty replacements, trailing-newline
 * guarantee, built-in stub loading, and published application stubs
 * overriding the built-ins.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MakeEnumCommand } from '@/Console/Commands/MakeEnumCommand';
import { Stub } from '@/Console/Generators/Stub';
import { OutputStyle } from '@/Console/Output/OutputStyle';
import { BUILT_IN_STUBS } from '@/Console/stubs';
import { Application } from '@/Foundation/Application';

describe('Stub.render', () => {
  it('replaces {{ key }} placeholders', () => {
    const output = Stub.render('export class {{ class }} {}', { class: 'Post' });

    expect(output).toBe('export class Post {}\n');
  });

  it('accepts the compact {{key}} form too', () => {
    expect(Stub.render('{{class}}/{{ table }}', { class: 'A', table: 'b' })).toBe('A/b\n');
  });

  it('replaces every occurrence of a key', () => {
    const output = Stub.render('{{ class }} - {{ class }}', { class: 'X' });

    expect(output).toBe('X - X\n');
  });

  it('leaves unknown placeholders verbatim', () => {
    expect(Stub.render('a {{ known }} {{ mystery }}', { known: 'ok' })).toBe('a ok {{ mystery }}\n');
  });

  it('cleans lines emptied by blank replacements', () => {
    const template = 'first\n{{ gap }}\n\n\nlast';

    expect(Stub.render(template, { gap: '' })).toBe('first\n\nlast\n');
  });

  it('strips trailing whitespace left by replacements', () => {
    expect(Stub.render('class X {{ maybe }}\n{}', { maybe: '' })).toBe('class X\n{}\n');
  });

  it('guarantees a trailing newline', () => {
    expect(Stub.render('no newline', {})).toBe('no newline\n');
    expect(Stub.render('already\n', {})).toBe('already\n');
  });
});

describe('Stub.load', () => {
  let basePath: string;

  beforeEach(() => {
    basePath = join(tmpdir(), `orchestr-test-stub-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(basePath, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(basePath)) {
      rmSync(basePath, { recursive: true, force: true });
    }
  });

  it('returns built-in templates by name', async () => {
    const model = await Stub.load('model');

    expect(model).toBe(BUILT_IN_STUBS.model);
    expect(model).toContain('extends Ensemble');
  });

  it('lets a published app stub override the built-in', async () => {
    mkdirSync(join(basePath, 'stubs'), { recursive: true });
    writeFileSync(join(basePath, 'stubs', 'model.stub'), '// custom model {{ class }}\n');

    const model = await Stub.load('model', join(basePath, 'stubs'));

    expect(model).toBe('// custom model {{ class }}\n');
    expect(Stub.render(model, { class: 'Post' })).toBe('// custom model Post\n');
  });

  it('falls back to the built-in when no override exists', async () => {
    mkdirSync(join(basePath, 'stubs'), { recursive: true });

    expect(await Stub.load('model', join(basePath, 'stubs'))).toBe(BUILT_IN_STUBS.model);
  });

  it('consults override directories in order', async () => {
    mkdirSync(join(basePath, 'first'), { recursive: true });
    writeFileSync(join(basePath, 'first', 'policy.stub'), 'first');
    mkdirSync(join(basePath, 'second'), { recursive: true });
    writeFileSync(join(basePath, 'second', 'channel.stub'), 'second');

    expect(await Stub.load('policy', join(basePath, 'first'), join(basePath, 'second'))).toBe('first');
    expect(await Stub.load('channel', join(basePath, 'first'), join(basePath, 'second'))).toBe('second');
  });

  it('throws a helpful error for unknown stub names', async () => {
    await expect(Stub.load('no-such-stub')).rejects.toThrow(/Unknown generator stub "no-such-stub"/);
  });

  it('ships every generator stub registered', () => {
    expect(Object.keys(BUILT_IN_STUBS).length).toBeGreaterThanOrEqual(27);

    for (const template of Object.values(BUILT_IN_STUBS)) {
      expect(template.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('Stub overrides through a generator', () => {
  let basePath: string;

  beforeEach(() => {
    basePath = join(tmpdir(), `orchestr-test-stub-override-${Date.now()}`);
    mkdirSync(basePath, { recursive: true });
    mkdirSync(join(basePath, 'stubs'), { recursive: true });
  });

  afterEach(() => {
    rmSync(basePath, { recursive: true, force: true });
  });

  it('make:enum renders the published stubs/enum.stub instead of the built-in', async () => {
    const app = new Application(basePath);
    const command = new MakeEnumCommand(app);
    command.setStyle(new OutputStyle({ decorated: false, quiet: true, interactive: false }));

    writeFileSync(
      join(basePath, 'stubs', 'enum.stub'),
      '// {{ class }} from the published stub\nexport enum {{ class }} { On, Off }\n'
    );

    await command.handle(['SwitchState'], {});

    const generated = readFileSync(join(basePath, 'app', 'Enums', 'SwitchState.ts'), 'utf-8');
    expect(generated).toContain('from the published stub');
    expect(generated).toContain('export enum SwitchState { On, Off }');
    expect(generated).not.toContain(BUILT_IN_STUBS.enum);
  });
});
