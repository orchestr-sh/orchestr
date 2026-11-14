/**
 * CommandDiscovery tests
 *
 * Covers directory scanning (`app/Console/Commands` style), export
 * filtering, container-based resolution so commands can inject services,
 * deduplication, and registration into the kernel (including name overrides
 * of manifest commands).
 */

import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { ModuleImporter } from '@/Console/Discovery/CommandDiscovery';
import { Command } from '@/Console/Command';
import { ConsoleKernel } from '@/Console/ConsoleKernel';
import { CommandDiscovery } from '@/Console/Discovery/CommandDiscovery';
import { Application } from '@/Foundation/Application';

class Greeter {
  greet(name: string): string {
    return `hello ${name}`;
  }
}

class GreetingCommand extends Command {
  signature = 'app:greet {name?}';
  description = 'Greet through an injected service';

  constructor(
    protected app: Application,
    public greeter: Greeter = new Greeter()
  ) {
    super();
  }

  async handle(args: string[]): Promise<void> {
    this.info(this.greeter.greet(args[0] ?? 'world'));
  }
}

class OverrideCommand extends Command {
  signature = 'app:override-me';
  description = 'The discovered override';

  async handle(): Promise<void> {
    this.info('overridden');
  }
}

class ManifestLikeCommand extends Command {
  signature = 'app:override-me';
  description = 'The original';

  async handle(): Promise<void> {
    // no-op
  }
}

/** Importer serving fixed module records keyed by file path. */
function fakeImporter(modules: Record<string, Record<string, unknown>>): ModuleImporter {
  return async (file: string) => modules[file] ?? {};
}

describe('CommandDiscovery', () => {
  let directory: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'orchestr-discovery-'));
    // Files only need to exist for the directory scan; the injected
    // importer controls what each "module" exports.
    await writeFile(join(directory, 'GreetingCommand.mjs'), 'export class GreetingCommand {}');
    await writeFile(join(directory, 'OverrideCommand.js'), 'export class OverrideCommand {}');
    await writeFile(join(directory, 'notes.txt'), 'ignored');
    await writeFile(join(directory, 'Types.d.ts'), 'ignored');
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const modules = () => ({
    [join(directory, 'GreetingCommand.mjs')]: { GreetingCommand, AliasOfGreeting: GreetingCommand, notAClass: 42 },
    [join(directory, 'OverrideCommand.js')]: { OverrideCommand },
  });

  it('discovers Command subclasses exported from files in the directory', async () => {
    const app = new Application('/test');
    const discovery = new CommandDiscovery(app, fakeImporter(modules()));

    const commands = await discovery.discover([directory]);

    expect(commands.map((command) => command.getName()).sort()).toEqual(['app:greet', 'app:override-me']);
  });

  it('ignores files whose extension is not a module', async () => {
    const app = new Application('/test');
    const seen: string[] = [];
    const discovery = new CommandDiscovery(app, async (file) => {
      seen.push(file);
      return {};
    });

    await discovery.discover([directory]);

    expect(seen).toEqual([join(directory, 'GreetingCommand.mjs'), join(directory, 'OverrideCommand.js')]);
  });

  it('resolves commands through the container so services can be injected', async () => {
    const app = new Application('/test');
    const greeter = new Greeter();
    app.bind(Greeter, () => greeter);
    app.bind(GreetingCommand, (container) => new GreetingCommand(app, container.make(Greeter)));

    const discovery = new CommandDiscovery(app, fakeImporter(modules()));
    const commands = await discovery.discover([directory]);

    const greeting = commands.find((command) => command instanceof GreetingCommand) as GreetingCommand;
    expect(greeting.greeter).toBe(greeter);
  });

  it('falls back to passing the application to unbound command classes', async () => {
    const app = new Application('/test');
    const discovery = new CommandDiscovery(app, fakeImporter(modules()));

    const commands = await discovery.discover([directory]);
    const greeting = commands.find((command) => command instanceof GreetingCommand) as GreetingCommand;

    // No container binding exists, so the fallback first parameter wires
    // the Application into the constructor even without decorator metadata.
    expect(greeting['app']).toBe(app);
  });

  it('registers each discovered class once even when re-exported', async () => {
    const app = new Application('/test');
    const discovery = new CommandDiscovery(app, fakeImporter(modules()));

    const commands = await discovery.discover([directory]);

    expect(commands.filter((command) => command instanceof GreetingCommand)).toHaveLength(1);
  });

  it('returns nothing for directories that do not exist', async () => {
    const app = new Application('/test');
    const discovery = new CommandDiscovery(app);

    expect(await discovery.discover([join(directory, 'missing')])).toEqual([]);
  });

  it('defaults to app/Console/Commands under the application base path', async () => {
    const app = new Application('/project');
    const discovery = new CommandDiscovery(app);

    // The conventional directory does not exist, so discovery finds nothing
    // but must target the conventional path.
    expect(await discovery.discover()).toEqual([]);
    expect(app.path('Console/Commands')).toBe('/project/app/Console/Commands');
  });

  describe('isCommandClass', () => {
    it('accepts subclasses and rejects the base class, instances, and plain exports', () => {
      expect(CommandDiscovery.isCommandClass(GreetingCommand)).toBe(true);
      expect(CommandDiscovery.isCommandClass(Command)).toBe(false);
      expect(CommandDiscovery.isCommandClass(new GreetingCommand(new Application('/test')))).toBe(false);
      expect(CommandDiscovery.isCommandClass(() => 1)).toBe(false);
      expect(CommandDiscovery.isCommandClass('string')).toBe(false);
    });
  });
});

describe('ConsoleKernel.discoverCommands()', () => {
  let directory: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'orchestr-kernel-discovery-'));
    await writeFile(join(directory, 'GreetingCommand.mjs'), 'export class GreetingCommand {}');
    await writeFile(join(directory, 'OverrideCommand.mjs'), 'export class OverrideCommand {}');
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const kernelModules = () => ({
    [join(directory, 'GreetingCommand.mjs')]: { GreetingCommand },
    [join(directory, 'OverrideCommand.mjs')]: { OverrideCommand },
  });

  it('registers discovered commands and lets them override earlier registrations', async () => {
    const app = new Application('/test');
    const kernel = new ConsoleKernel(app);
    kernel.registerMany([new ManifestLikeCommand()]);

    await kernel.discoverCommands([directory], fakeImporter(kernelModules()));

    expect(kernel.getCommands().get('app:override-me')?.constructor.name).toBe('OverrideCommand');
    expect(kernel.getCommands().get('app:override-me')?.description).toBe('The discovered override');
  });

  it('resolves discovered command constructors through the container', async () => {
    const app = new Application('/test');
    const kernel = new ConsoleKernel(app);
    const greeter = new Greeter();
    app.bind(Greeter, () => greeter);
    app.bind(GreetingCommand, (container) => new GreetingCommand(app, container.make(Greeter)));

    await kernel.discoverCommands([directory], fakeImporter(kernelModules()));

    expect((kernel.getCommands().get('app:greet') as GreetingCommand).greeter).toBe(greeter);
  });
});
