/**
 * MakePolicyCommand tests
 *
 * Acceptance: `make:policy PostPolicy --model=Post` creates a policy with
 * the standard ability methods; --path/--force behave like every other
 * generator.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MakePolicyCommand } from '@/Console/Commands/MakePolicyCommand';
import { OutputStyle } from '@/Console/Output/OutputStyle';
import { Application } from '@/Foundation/Application';

describe('MakePolicyCommand', () => {
  let app: Application;
  let command: MakePolicyCommand;
  let basePath: string;

  beforeEach(() => {
    basePath = join(tmpdir(), `orchestr-test-policy-${Date.now()}`);
    mkdirSync(basePath, { recursive: true });
    app = new Application(basePath);
    command = new MakePolicyCommand(app);
    command.setStyle(new OutputStyle({ decorated: false, quiet: true, interactive: false }));
  });

  afterEach(() => {
    rmSync(basePath, { recursive: true, force: true });
  });

  it('creates a model-bound policy with the standard ability methods', async () => {
    await command.handle(['PostPolicy'], { model: 'Post' });

    const filePath = join(basePath, 'app', 'Policies', 'PostPolicy.ts');
    expect(existsSync(filePath)).toBe(true);

    const content = readFileSync(filePath, 'utf-8');
    expect(content).toContain('Namespace: App\\Policies');
    expect(content).toContain("import { Policy } from '@orchestr-sh/orchestr'");
    expect(content).toContain("import type { Authenticatable } from '@orchestr-sh/orchestr'");
    expect(content).toContain("import { Post } from '../Models/Post'");
    expect(content).toContain('export class PostPolicy extends Policy');

    for (const ability of ['viewAny', 'view', 'create', 'update', 'delete', 'restore', 'forceDelete']) {
      expect(content).toContain(`${ability}(user: Authenticatable`);
    }

    // The model verbs receive the model instance.
    expect(content).toContain('update(user: Authenticatable, post: Post): boolean');
    expect(content).toContain('delete(user: Authenticatable, post: Post): boolean');
  });

  it('creates a user-only policy when no model is bound', async () => {
    await command.handle(['PostPolicy'], {});

    const content = readFileSync(join(basePath, 'app', 'Policies', 'PostPolicy.ts'), 'utf-8');

    expect(content).toContain('export class PostPolicy extends Policy');
    expect(content).not.toContain('post: Post');
    expect(content).not.toContain('import { Post }');
  });

  it('refuses existing files without --force', async () => {
    await command.handle(['PostPolicy'], { model: 'Post' });
    const filePath = join(basePath, 'app', 'Policies', 'PostPolicy.ts');
    writeFileSync(filePath, '// hand-written');

    await command.handle(['PostPolicy'], { model: 'Post' });
    expect(readFileSync(filePath, 'utf-8')).toBe('// hand-written');

    await command.handle(['PostPolicy'], { model: 'Post', force: true });
    expect(readFileSync(filePath, 'utf-8')).toContain('extends Policy');
  });
});
