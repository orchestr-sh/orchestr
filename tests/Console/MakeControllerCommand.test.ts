import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Application } from '../../src/Foundation/Application';
import { MakeControllerCommand } from '../../src/Console/Commands/MakeControllerCommand';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('MakeControllerCommand', () => {
  let app: Application;
  let command: MakeControllerCommand;
  let basePath: string;

  beforeEach(() => {
    basePath = join(tmpdir(), `orchestr-test-controller-${Date.now()}`);
    mkdirSync(basePath, { recursive: true });
    app = new Application(basePath);
    command = new MakeControllerCommand(app);
  });

  afterEach(() => {
    if (existsSync(basePath)) {
      rmSync(basePath, { recursive: true });
    }
  });

  describe('handle()', () => {
    it('creates the named controller and base Controller when base does not exist', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await command.handle(['UserController'], {});

      const controllersPath = join(basePath, 'app', 'Http', 'Controllers');
      const controllerPath = join(controllersPath, 'UserController.ts');
      const baseControllerPath = join(controllersPath, 'Controller.ts');

      expect(existsSync(controllerPath)).toBe(true);
      expect(existsSync(baseControllerPath)).toBe(true);

      const controllerContent = readFileSync(controllerPath, 'utf-8');
      expect(controllerContent).toContain('export class UserController extends Controller');
      expect(controllerContent).toContain("import { Controller } from './Controller'");

      const baseContent = readFileSync(baseControllerPath, 'utf-8');
      expect(baseContent).toContain('Base Controller');
      expect(baseContent).toContain("import { Controller as BaseController } from '@orchestr-sh/orchestr'");
      expect(baseContent).toContain('export class Controller extends BaseController');

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Controller created successfully'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Use it in your routes'));

      logSpy.mockRestore();
    });

    it('creates only the named controller when base Controller already exists', async () => {
      const controllersPath = join(basePath, 'app', 'Http', 'Controllers');
      mkdirSync(controllersPath, { recursive: true });
      const baseControllerPath = join(controllersPath, 'Controller.ts');
      const existingBase = '// existing base controller';
      writeFileSync(baseControllerPath, existingBase);

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await command.handle(['PostController'], {});

      const controllerPath = join(controllersPath, 'PostController.ts');
      expect(existsSync(controllerPath)).toBe(true);
      expect(readFileSync(baseControllerPath, 'utf-8')).toBe(existingBase);

      logSpy.mockRestore();
    });

    it('generated controller has correct class name and extends Controller', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});

      await command.handle(['ApiUserController'], {});

      const content = readFileSync(
        join(basePath, 'app', 'Http', 'Controllers', 'ApiUserController.ts'),
        'utf-8'
      );
      expect(content).toContain('ApiUserController Controller');
      expect(content).toContain('export class ApiUserController extends Controller');
    });

    it('errors when controller name is missing', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await command.handle([], {});

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Controller name is required'));
      expect(logSpy).toHaveBeenCalledWith('Usage: make:controller <name>');
      errorSpy.mockRestore();
      logSpy.mockRestore();
    });

    it('errors when controller already exists', async () => {
      const controllersPath = join(basePath, 'app', 'Http', 'Controllers');
      mkdirSync(controllersPath, { recursive: true });
      const controllerPath = join(controllersPath, 'UserController.ts');
      writeFileSync(controllerPath, '// existing');

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await command.handle(['UserController'], {});

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Controller already exists')
      );
      errorSpy.mockRestore();
    });

    it('respects --path option for custom controllers directory', async () => {
      const customPath = join(basePath, 'custom', 'controllers');
      vi.spyOn(console, 'log').mockImplementation(() => {});

      await command.handle(['CustomController'], { path: customPath });

      expect(existsSync(join(customPath, 'CustomController.ts'))).toBe(true);
      expect(existsSync(join(customPath, 'Controller.ts'))).toBe(true);
    });
  });

  describe('signature and description', () => {
    it('has correct signature', () => {
      expect(command.signature).toBe('make:controller <name>');
    });

    it('has correct description', () => {
      expect(command.description).toBe('Create a new controller class');
    });
  });
});
