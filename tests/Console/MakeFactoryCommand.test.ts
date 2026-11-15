/**
 * MakeFactoryCommand tests
 *
 * Covers both stub variants: the factory bound to its model (guessed from
 * the class name or given via --model) and the pending variant that keeps
 * the pairing as a commented registerFactory() call.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MakeFactoryCommand } from '@/Console/Commands/MakeFactoryCommand';
import { OutputStyle } from '@/Console/Output/OutputStyle';
import { Application } from '@/Foundation/Application';

describe('MakeFactoryCommand', () => {
  let app: Application;
  let command: MakeFactoryCommand;
  let basePath: string;

  beforeEach(() => {
    basePath = join(tmpdir(), `orchestr-test-factory-${Date.now()}`);
    mkdirSync(basePath, { recursive: true });
    app = new Application(basePath);
    command = new MakeFactoryCommand(app);
    command.setStyle(new OutputStyle({ decorated: false, quiet: true, interactive: false }));
  });

  afterEach(() => {
    rmSync(basePath, { recursive: true, force: true });
  });

  it('guesses the model from the class name and binds the factory', async () => {
    await command.handle(['PostFactory'], {});

    const filePath = join(basePath, 'database', 'factories', 'PostFactory.ts');
    expect(existsSync(filePath)).toBe(true);

    const content = readFileSync(filePath, 'utf-8');
    expect(content).toContain('Namespace: Database\\Factories');
    expect(content).toContain("import { Post } from '../../app/Models/Post'");
    expect(content).toContain('export class PostFactory extends Factory<Post>');
    expect(content).toContain('static model = Post;');
    expect(content).toContain('registerFactory(PostFactory);');
  });

  it('binds the model given via --model', async () => {
    await command.handle(['WidgetFactory'], { model: 'Gadget' });

    const content = readFileSync(join(basePath, 'database', 'factories', 'WidgetFactory.ts'), 'utf-8');

    expect(content).toContain("import { Gadget } from '../../app/Models/Gadget'");
    expect(content).toContain('extends Factory<Gadget>');
  });

  it('falls back to the pending stub when no model can be resolved', async () => {
    await command.handle(['RandomAttributeSets'], {});

    const content = readFileSync(join(basePath, 'database', 'factories', 'RandomAttributeSets.ts'), 'utf-8');

    expect(content).toContain('import { Ensemble, Factory } from');
    expect(content).toContain('export class RandomAttributeSets extends Factory<Ensemble>');
    expect(content).toContain('registerFactory(RandomAttributeSets, YourModel)');
  });

  it('refuses existing files without --force', async () => {
    await command.handle(['PostFactory'], {});
    const filePath = join(basePath, 'database', 'factories', 'PostFactory.ts');
    writeFileSync(filePath, '// hand-written');

    await command.handle(['PostFactory'], {});
    expect(readFileSync(filePath, 'utf-8')).toBe('// hand-written');

    await command.handle(['PostFactory'], { force: true });
    expect(readFileSync(filePath, 'utf-8')).toContain('extends Factory<Post>');
  });
});
