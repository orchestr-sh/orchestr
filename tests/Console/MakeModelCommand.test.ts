/**
 * MakeModelCommand tests
 *
 * Covers the model file itself (path, namespace, class, imports, table),
 * the companion artefacts for --migration/--factory/--seed, --all,
 * --pivot (with and without --table), subdirectory inputs, --path, the
 * refuse-to-overwrite contract, --force, and kernel dispatch with the
 * -m/--all shortcuts.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MakeModelCommand } from '@/Console/Commands/MakeModelCommand';
import { ConsoleKernel } from '@/Console/ConsoleKernel';
import { OutputStyle } from '@/Console/Output/OutputStyle';
import { Application } from '@/Foundation/Application';

describe('MakeModelCommand', () => {
  let app: Application;
  let command: MakeModelCommand;
  let basePath: string;

  beforeEach(() => {
    basePath = join(tmpdir(), `orchestr-test-model-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(basePath, { recursive: true });
    app = new Application(basePath);
    command = new MakeModelCommand(app);
    command.setStyle(new OutputStyle({ decorated: false, quiet: true, interactive: false }));
  });

  afterEach(() => {
    rmSync(basePath, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe('the model file', () => {
    it('creates app/Models with the Ensemble base and guessed table', async () => {
      await command.handle(['Post'], {});

      const filePath = join(basePath, 'app', 'Models', 'Post.ts');
      expect(existsSync(filePath)).toBe(true);

      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain('Namespace: App\\Models');
      expect(content).toContain("import { Ensemble } from '@orchestr-sh/orchestr'");
      expect(content).toContain('export class Post extends Ensemble');
      expect(content).toContain("protected table = 'posts'");
    });

    it('puts subdirectory inputs in matching directories with the right namespace', async () => {
      await command.handle(['Admin/Page'], {});

      const filePath = join(basePath, 'app', 'Models', 'Admin', 'Page.ts');
      expect(existsSync(filePath)).toBe(true);
      expect(readFileSync(filePath, 'utf-8')).toContain('Namespace: App\\Models\\Admin');
    });

    it('honours --table for the table name', async () => {
      await command.handle(['Post'], { table: 'blog_posts' });

      expect(readFileSync(join(basePath, 'app', 'Models', 'Post.ts'), 'utf-8')).toContain(
        "protected table = 'blog_posts'"
      );
    });

    it('honours --path for a custom location', async () => {
      await command.handle(['Post'], { path: join(basePath, 'domain', 'Entities') });

      expect(existsSync(join(basePath, 'domain', 'Entities', 'Post.ts'))).toBe(true);
    });

    it('errors when the name is missing', async () => {
      const errors: string[] = [];
      const logs: string[] = [];

      command.setStyle(
        new OutputStyle({
          decorated: false,
          interactive: false,
          writer: {
            error: (message: string) => void errors.push(message),
            log: (message: string) => void logs.push(message),
          },
        })
      );

      await command.handle([], {});

      expect(errors.join('\n')).toContain('Model name is required.');
      expect(logs.join('\n')).toContain('Usage: make:model <name>');
    });
  });

  describe('refusing to overwrite', () => {
    it('keeps existing files untouched without --force and replaces them with --force', async () => {
      const modelsPath = join(basePath, 'app', 'Models');
      mkdirSync(modelsPath, { recursive: true });
      const filePath = join(modelsPath, 'Post.ts');
      writeFileSync(filePath, '// hand-written model');

      await command.handle(['Post'], {});
      expect(readFileSync(filePath, 'utf-8')).toBe('// hand-written model');

      await command.handle(['Post'], { force: true });
      expect(readFileSync(filePath, 'utf-8')).toContain('export class Post extends Ensemble');
    });
  });

  describe('companion artefacts', () => {
    it('--migration creates a create_posts_table migration in database/migrations', async () => {
      await command.handle(['Post'], { migration: true });

      const migrationsPath = join(basePath, 'database', 'migrations');
      const files = readdirSync(migrationsPath);

      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/^\d{4}_\d{2}_\d{2}_\d{6}_create_posts_table\.ts$/);

      const content = readFileSync(join(migrationsPath, files[0]), 'utf-8');
      expect(content).toContain("await schema.create('posts'");
      expect(content).toContain("await schema.dropIfExists('posts')");
      expect(content).toContain("import { Migration } from '@orchestr-sh/orchestr'");
    });

    it('--factory creates a factory bound to the model', async () => {
      await command.handle(['Post'], { factory: true });

      const filePath = join(basePath, 'database', 'factories', 'PostFactory.ts');
      expect(existsSync(filePath)).toBe(true);

      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain('Namespace: Database\\Factories');
      expect(content).toContain("import { Post } from '../../app/Models/Post'");
      expect(content).toContain('export class PostFactory extends Factory<Post>');
      expect(content).toContain('static model = Post');
      expect(content).toContain('registerFactory(PostFactory)');
    });

    it('--seed creates a seeder in database/seeders', async () => {
      await command.handle(['Post'], { seed: true });

      const filePath = join(basePath, 'database', 'seeders', 'PostSeeder.ts');
      expect(existsSync(filePath)).toBe(true);

      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain('Namespace: Database\\Seeders');
      expect(content).toContain('export default class PostSeeder extends Seeder');
      expect(content).toContain('async run(): Promise<void>');
    });

    it('--all creates the model, migration, factory, and seeder', async () => {
      await command.handle(['Post'], { all: true });

      const migrations = readdirSync(join(basePath, 'database', 'migrations'));

      expect(existsSync(join(basePath, 'app', 'Models', 'Post.ts'))).toBe(true);
      expect(migrations).toHaveLength(1);
      expect(migrations[0]).toMatch(/_create_posts_table\.ts$/);
      expect(existsSync(join(basePath, 'database', 'factories', 'PostFactory.ts'))).toBe(true);
      expect(existsSync(join(basePath, 'database', 'seeders', 'PostSeeder.ts'))).toBe(true);
    });

    it('--pivot uses the pivot stub and requires --table', async () => {
      const errors: string[] = [];
      const logs: string[] = [];

      command.setStyle(
        new OutputStyle({
          decorated: false,
          interactive: false,
          writer: {
            error: (message: string) => void errors.push(message),
            log: (message: string) => void logs.push(message),
          },
        })
      );

      await command.handle(['Group'], { pivot: true });
      expect(errors.join('\n')).toContain('The [pivot] option requires [table].');
      expect(existsSync(join(basePath, 'app', 'Models', 'Group.ts'))).toBe(false);

      await command.handle(['Group'], { pivot: true, table: 'user_group' });
      expect(readFileSync(join(basePath, 'app', 'Models', 'Group.ts'), 'utf-8')).toContain(
        "protected table = 'user_group'"
      );
    });

    it('forwards --force to companion artefacts', async () => {
      mkdirSync(join(basePath, 'app', 'Models'), { recursive: true });
      mkdirSync(join(basePath, 'database', 'seeders'), { recursive: true });
      writeFileSync(join(basePath, 'app', 'Models', 'Post.ts'), '// old model');
      writeFileSync(join(basePath, 'database', 'seeders', 'PostSeeder.ts'), '// old seeder');

      await command.handle(['Post'], { seed: true, force: true });

      expect(readFileSync(join(basePath, 'app', 'Models', 'Post.ts'), 'utf-8')).toContain('extends Ensemble');
      expect(readFileSync(join(basePath, 'database', 'seeders', 'PostSeeder.ts'), 'utf-8')).toContain('extends Seeder');
    });
  });

  describe('through the console kernel', () => {
    it('resolves shortcuts (-m) and the --all flag via the signature', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});

      const kernel = new ConsoleKernel(app);
      kernel.register(new MakeModelCommand(app));

      await kernel.handle('make:model', ['Post'], { m: true, all: true });

      expect(existsSync(join(basePath, 'app', 'Models', 'Post.ts'))).toBe(true);
      expect(readdirSync(join(basePath, 'database', 'migrations'))).toHaveLength(1);
      expect(existsSync(join(basePath, 'database', 'factories', 'PostFactory.ts'))).toBe(true);
      expect(existsSync(join(basePath, 'database', 'seeders', 'PostSeeder.ts'))).toBe(true);
    });

    it('validates the required argument', async () => {
      const kernel = new ConsoleKernel(app);
      kernel.register(new MakeModelCommand(app));

      await expect(kernel.handle('make:model', [], {})).rejects.toThrow('Not enough arguments to "make:model"');
    });
  });

  it('has the Laravel model signature', () => {
    expect(command.signature).toBe(
      'make:model {name} {--m|migration} {--f|factory} {--s|seed} {--p|pivot} {--table=} {--all} {--force}'
    );
    expect(command.description).toBe('Create a new model class');
  });
});
