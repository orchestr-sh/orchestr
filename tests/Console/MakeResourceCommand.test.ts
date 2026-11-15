/**
 * MakeResourceCommand / MakeCollectionCommand tests
 *
 * Acceptance: `make:resource PostResource` creates a JsonResource; the
 * collection generators wire `collects` when the sibling resource exists
 * and stay compiling without it.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MakeCollectionCommand } from '@/Console/Commands/MakeCollectionCommand';
import { MakeResourceCommand } from '@/Console/Commands/MakeResourceCommand';
import { OutputStyle } from '@/Console/Output/OutputStyle';
import { Application } from '@/Foundation/Application';

describe('MakeResourceCommand', () => {
  let app: Application;
  let command: MakeResourceCommand;
  let basePath: string;

  beforeEach(() => {
    basePath = join(tmpdir(), `orchestr-test-resource-${Date.now()}`);
    mkdirSync(basePath, { recursive: true });
    app = new Application(basePath);
    command = new MakeResourceCommand(app);
    command.setStyle(new OutputStyle({ decorated: false, quiet: true, interactive: false }));
  });

  afterEach(() => {
    rmSync(basePath, { recursive: true, force: true });
  });

  it('creates a JsonResource in app/Http/Resources', async () => {
    await command.handle(['PostResource'], {});

    const filePath = join(basePath, 'app', 'Http', 'Resources', 'PostResource.ts');
    expect(existsSync(filePath)).toBe(true);

    const content = readFileSync(filePath, 'utf-8');
    expect(content).toContain('Namespace: App\\Http\\Resources');
    expect(content).toContain("import { JsonResource } from '@orchestr-sh/orchestr'");
    expect(content).toContain('export class PostResource extends JsonResource');
    expect(content).toContain('toArray(request?: any): Record<string, any>');
  });

  it('renders the collection stub with --collection', async () => {
    await command.handle(['PostCollection'], { collection: true });

    const filePath = join(basePath, 'app', 'Http', 'Resources', 'PostCollection.ts');
    expect(existsSync(filePath)).toBe(true);

    const content = readFileSync(filePath, 'utf-8');
    expect(content).toContain('import { ResourceCollection } from');
    expect(content).toContain('export class PostCollection extends ResourceCollection');
  });

  it('refuses existing files without --force', async () => {
    await command.handle(['PostResource'], {});
    const filePath = join(basePath, 'app', 'Http', 'Resources', 'PostResource.ts');
    writeFileSync(filePath, '// hand-written');

    await command.handle(['PostResource'], {});
    expect(readFileSync(filePath, 'utf-8')).toBe('// hand-written');

    await command.handle(['PostResource'], { force: true });
    expect(readFileSync(filePath, 'utf-8')).toContain('extends JsonResource');
  });
});

describe('MakeCollectionCommand', () => {
  let app: Application;
  let command: MakeCollectionCommand;
  let basePath: string;

  beforeEach(() => {
    basePath = join(tmpdir(), `orchestr-test-collection-${Date.now()}`);
    mkdirSync(basePath, { recursive: true });
    app = new Application(basePath);
    command = new MakeCollectionCommand(app);
    command.setStyle(new OutputStyle({ decorated: false, quiet: true, interactive: false }));
  });

  afterEach(() => {
    rmSync(basePath, { recursive: true, force: true });
  });

  it('wires collects to the sibling resource when it exists', async () => {
    const resourcesPath = join(basePath, 'app', 'Http', 'Resources');
    mkdirSync(resourcesPath, { recursive: true });
    writeFileSync(join(resourcesPath, 'PostResource.ts'), 'export class PostResource {}\n');

    await command.handle(['PostCollection'], {});

    const content = readFileSync(join(resourcesPath, 'PostCollection.ts'), 'utf-8');
    expect(content).toContain("import { PostResource } from './PostResource';");
    expect(content).toContain('protected static collects = PostResource;');
  });

  it('leaves the pairing commented when the resource is missing', async () => {
    await command.handle(['PostCollection'], {});

    const content = readFileSync(join(basePath, 'app', 'Http', 'Resources', 'PostCollection.ts'), 'utf-8');
    expect(content).toContain("// import { PostResource } from './PostResource';");
    expect(content).toContain('// protected static collects = PostResource;');
  });

  it('has the documented signature and description', () => {
    expect(command.signature).toBe('make:collection {name} {--force}');
    expect(command.description).toBe('Create a new resource collection class');
  });
});
