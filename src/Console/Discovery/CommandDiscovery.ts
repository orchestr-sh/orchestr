/**
 * CommandDiscovery
 *
 * Finds console commands by scanning configured directories (by default
 * `app/Console/Commands`) and instantiating every exported `Command`
 * subclass through the service container, so discovered commands can inject
 * their own constructor dependencies exactly like provider-registered ones.
 *
 * Explicit manifests remain the other registration path (see
 * `src/Console/Commands/index.ts`); discovery complements them, and later
 * registrations win on duplicate command names, mirroring Laravel where an
 * application command may override a framework one.
 *
 * The module importer is injectable so embedders (and tests) can control
 * how files are loaded; the default importer uses a dynamic `import()` of
 * the file URL.
 */

import { readdir } from 'fs/promises';
import { extname, join } from 'path';
import { pathToFileURL } from 'url';
import { Application } from '@/Foundation/Application';
import { Command } from '../Command';

export type CommandClass = new (...args: any[]) => Command;
export type ModuleImporter = (filePath: string) => Promise<Record<string, unknown>>;

const COMMAND_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts']);

export class CommandDiscovery {
  /**
   * Default importer: loads a module file through its file URL. Bound as
   * an arrow so the default constructor parameter never loses `this`.
   */
  static importModule: ModuleImporter = (filePath: string) =>
    import(pathToFileURL(filePath).href) as Promise<Record<string, unknown>>;

  constructor(
    protected app: Application,
    protected importer: ModuleImporter = CommandDiscovery.importModule
  ) {}

  /**
   * True when the export is a concrete command class (a subclass of the
   * abstract `Command` base class).
   */
  static isCommandClass(value: unknown): value is CommandClass {
    return (
      typeof value === 'function' &&
      value !== (Command as unknown as Function) &&
      (value as CommandClass).prototype instanceof Command
    );
  }

  /**
   * Discover command instances in the given directories. Missing
   * directories are skipped silently so applications without a
   * `app/Console/Commands` folder pay nothing for discovery.
   */
  async discover(paths: string[] = [this.app.path('Console/Commands')]): Promise<Command[]> {
    const commands: Command[] = [];
    const seen: Set<CommandClass> = new Set();

    for (const directory of paths) {
      const entries = await this.list(directory);

      for (const entry of entries.sort()) {
        if (!this.isLoadableFile(entry)) {
          continue;
        }

        const exported = await this.importer(join(directory, entry));

        for (const value of Object.values(exported)) {
          if (!CommandDiscovery.isCommandClass(value) || seen.has(value)) {
            continue;
          }

          seen.add(value);
          commands.push(this.resolve(value));
        }
      }
    }

    return commands;
  }

  /**
   * Instantiate through the container so bindings, singletons, and
   * constructor injection all apply.
   */
  protected resolve(commandClass: CommandClass): Command {
    // The Application is passed positionally as the first fallback
    // parameter: classes bound in the container are free to ignore it,
    // unbound commands declaring an `Application` constructor parameter
    // receive it (via metadata, or directly when metadata is absent), and
    // parameterless constructors simply discard the extra argument.
    return this.app.make<Command>(commandClass, [this.app]);
  }

  protected async list(directory: string): Promise<string[]> {
    try {
      return await readdir(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }

      throw error;
    }
  }

  protected isLoadableFile(entry: string): boolean {
    return COMMAND_EXTENSIONS.has(extname(entry)) && !entry.endsWith('.d.ts') && !entry.endsWith('.test.ts');
  }
}
