/**
 * GeneratorCommand
 *
 * The shared skeleton behind every `make:*` generator, mirroring
 * Illuminate\Console\GeneratorCommand. The base owns the parts that must
 * not be rewritten per command (DRY/SRP):
 *
 * - name resolution - the input may carry subdirectories (Laravel's
 *   `Admin/UserController`), which become subdirectories of the artefact's
 *   destination;
 * - the namespace/path mapping - destinations come from the application's
 *   configured paths (`app/`, `database/`, `tests/`, ...), and the rendered
 *   `{{ namespace }}` is derived from the same mapping (app/Models becomes
 *   `App\Models`);
 * - the stub pipeline - templates are resolved through `Stub`, so a
 *   published `stubs/<name>.stub` in the application overrides the built-in
 *   for every generator;
 * - the refuse-to-overwrite contract: existing files error unless `--force`.
 *
 * Adding a generator therefore means adding a stub plus a small subclass
 * that names its stub and its directory (OCP) - never a switch.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { Application } from '@/Foundation/Application';
import { Str } from '@/Support/Str';
import { Command, CommandOptions } from '../Command';
import { Stub, StubReplacements } from './Stub';

/**
 * Everything the base resolved from the generator's input; handed to the
 * subclass hooks so they never redo the path/namespace math.
 */
export interface GeneratorContext {
  /** Class name of the artefact, e.g. `StorePostRequest`. */
  className: string;
  /** Directory the file lands in, after `--path` and subdirectory input. */
  directory: string;
  /** Full path of the file about to be written. */
  filePath: string;
  /** Namespace rendered as `{{ namespace }}`, e.g. `App\Http\Requests`. */
  namespace: string;
  /** Subdirectories carried by the name input, e.g. `['Admin']`. */
  subdirectory: string[];
}

export abstract class GeneratorCommand extends Command {
  /**
   * Human name of the generated artefact, used in success, error, and
   * usage messages ("Model created successfully: ...").
   */
  protected abstract artifact: string;

  constructor(protected app: Application) {
    super();
  }

  /**
   * Name of the stub template the artefact renders from.
   */
  protected abstract stubName(context: GeneratorContext, options: CommandOptions): string;

  /**
   * Destination directory for the artefact (before `--path` overrides and
   * subdirectories carried by the name input).
   */
  protected abstract targetDirectory(options: CommandOptions): string;

  /**
   * Placeholder values this generator adds beyond `class`, `namespace`,
   * and `namespaced_class`.
   */
  protected replacements(context: GeneratorContext, options: CommandOptions): StubReplacements {
    return {};
  }

  /**
   * File extension of the generated file.
   */
  protected extension(context: GeneratorContext, options: CommandOptions): string {
    return '.ts';
  }

  /**
   * Validate flag combinations before anything is written; returning a
   * message aborts the run with that error.
   */
  protected validateInput(context: GeneratorContext, options: CommandOptions): string | null {
    return null;
  }

  /**
   * Hook that runs after the primary file has been written - where
   * `make:model` spawns its matching migration/factory/seeder.
   */
  protected async created(context: GeneratorContext, options: CommandOptions): Promise<void> {
    //
  }

  /**
   * Resolve the input, render the stub, and write the generated file.
   */
  async handle(args: string[], options: CommandOptions): Promise<void> {
    const input = (args[0] ?? '').trim();

    if (input === '') {
      this.error(`${this.artifact} name is required.`);
      this.line(`Usage: ${this.getName()} <name>`);

      return;
    }

    const segments = input.split(/[\\/]/).filter((segment) => segment !== '');
    const className = segments[segments.length - 1];
    const subdirectory = segments.slice(0, -1);
    const directory = this.destinationDirectory(subdirectory, options);
    const namespace = this.namespaceFor(directory);
    const context: GeneratorContext = { className, directory, filePath: '', namespace, subdirectory };
    context.filePath = path.join(directory, className + this.extension(context, options));
    const filePath = context.filePath;

    const invalid = this.validateInput(context, options);

    if (invalid !== null) {
      this.error(invalid);

      return;
    }

    if (!this.flag(options, 'force') && (await this.fileExists(filePath))) {
      this.error(`${this.artifact} already exists: ${filePath}`);

      return;
    }

    const template = await Stub.load(this.stubName(context, options), path.join(this.app.getBasePath(), 'stubs'));
    const content = Stub.render(template, {
      class: className,
      namespace,
      namespaced_class: `${namespace}\\${className}`,
      ...this.replacements(context, options),
    });

    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(filePath, content);

    this.info(`${this.artifact} created successfully: ${filePath}`);

    await this.created(context, options);
  }

  /**
   * The application's root namespace segment (`App` for `app/`), reused
   * when a `--path` sits outside the configured mapping.
   */
  protected rootNamespace(): string {
    return 'App';
  }

  /**
   * Namespace the generated file's directory maps to: every path segment
   * below the application root, studly-cased and joined with backslashes
   * the way the framework's own conventions do (`App\Policies`,
   * `Database\Factories`, `Tests\Feature`).
   */
  protected namespaceFor(directory: string): string {
    const relative = path.relative(this.app.getBasePath(), directory);

    if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
      return this.rootNamespace();
    }

    return relative
      .split(path.sep)
      .map((segment) => Str.studly(segment))
      .join('\\');
  }

  /**
   * The directory the artefact lands in: `--path` wins outright, then the
   * command's target directory, extended by any subdirectories the name
   * input carried.
   */
  protected destinationDirectory(subdirectory: string[], options: CommandOptions): string {
    const base = typeof options.path === 'string' && options.path !== '' ? options.path : this.targetDirectory(options);

    return subdirectory.length > 0 ? path.join(base, ...subdirectory) : base;
  }

  /**
   * Relative module specifier from one configured directory to a file in
   * another - how generated code reaches models, resources, and the like
   * through the project's path mapping instead of hard-coded paths.
   */
  protected relativeImport(fromDirectory: string, toFile: string): string {
    const relative = path.relative(fromDirectory, toFile).split(path.sep).join('/').replace(/\.ts$/u, '');

    return relative.startsWith('.') ? relative : `./${relative}`;
  }

  /**
   * Read a boolean flag, accepting the canonical name, a declared
   * shortcut, and `'true'` strings so direct programmatic calls behave
   * like a kernel dispatch.
   */
  protected flag(options: CommandOptions, name: string, shortcut?: string): boolean {
    for (const key of shortcut === undefined ? [name] : [name, shortcut]) {
      const value = options[key];

      if (value === true || value === 'true') {
        return true;
      }
    }

    return false;
  }

  /**
   * Read a value option; a bare flag (`--model` with no value) reads as
   * absent.
   */
  protected valueOption(options: CommandOptions, name: string): string | undefined {
    const value = options[name];

    return typeof value === 'string' && value !== '' ? value : undefined;
  }

  /**
   * Laravel's table-name convention for a model: snake-cased plural.
   */
  protected tableName(className: string): string {
    return Str.snake(Str.plural(className));
  }

  /**
   * Check if a file exists
   */
  protected async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);

      return true;
    } catch {
      return false;
    }
  }
}
