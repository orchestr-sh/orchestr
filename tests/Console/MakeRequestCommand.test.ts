/**
 * MakeRequestCommand tests
 *
 * Acceptance: `make:request StorePostRequest` creates a FormRequest with a
 * rules() method, in app/Http/Requests, under the App\Http\Requests
 * namespace; existing files need --force to be replaced.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MakeRequestCommand } from '@/Console/Commands/MakeRequestCommand';
import { OutputStyle } from '@/Console/Output/OutputStyle';
import { Application } from '@/Foundation/Application';

describe('MakeRequestCommand', () => {
  let app: Application;
  let command: MakeRequestCommand;
  let basePath: string;

  beforeEach(() => {
    basePath = join(tmpdir(), `orchestr-test-request-${Date.now()}`);
    mkdirSync(basePath, { recursive: true });
    app = new Application(basePath);
    command = new MakeRequestCommand(app);
    command.setStyle(new OutputStyle({ decorated: false, quiet: true, interactive: false }));
  });

  afterEach(() => {
    rmSync(basePath, { recursive: true, force: true });
  });

  it('creates a FormRequest with authorize() and rules() in app/Http/Requests', async () => {
    await command.handle(['StorePostRequest'], {});

    const filePath = join(basePath, 'app', 'Http', 'Requests', 'StorePostRequest.ts');
    expect(existsSync(filePath)).toBe(true);

    const content = readFileSync(filePath, 'utf-8');
    expect(content).toContain('Namespace: App\\Http\\Requests');
    expect(content).toContain("import { FormRequest } from '@orchestr-sh/orchestr'");
    expect(content).toContain("import type { ValidationRules } from '@orchestr-sh/orchestr'");
    expect(content).toContain('export class StorePostRequest extends FormRequest');
    expect(content).toContain('protected authorize(): boolean');
    expect(content).toContain('protected rules(): ValidationRules');
  });

  it('creates parent directories', async () => {
    await command.handle(['Admin/StoreThingRequest'], {});

    const filePath = join(basePath, 'app', 'Http', 'Requests', 'Admin', 'StoreThingRequest.ts');
    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath, 'utf-8')).toContain('Namespace: App\\Http\\Requests\\Admin');
  });

  it('refuses existing files without --force and overwrites with it', async () => {
    await command.handle(['StorePostRequest'], {});
    const filePath = join(basePath, 'app', 'Http', 'Requests', 'StorePostRequest.ts');
    writeFileSync(filePath, '// hand-written');

    await command.handle(['StorePostRequest'], {});
    expect(readFileSync(filePath, 'utf-8')).toBe('// hand-written');

    await command.handle(['StorePostRequest'], { force: true });
    expect(readFileSync(filePath, 'utf-8')).toContain('extends FormRequest');
  });

  it('honours --path', async () => {
    const custom = join(basePath, 'validation');
    await command.handle(['CustomRequest'], { path: custom });

    expect(existsSync(join(custom, 'CustomRequest.ts'))).toBe(true);
  });

  it('has the documented signature and description', () => {
    expect(command.signature).toBe('make:request {name} {--force}');
    expect(command.description).toBe('Create a new form request class');
  });
});
