import { describe, it, expect, vi } from 'vitest';
import { Command } from '@/Console/Command';
import { coreCommands, deployCommands } from '@/Console/Commands';
import { ConsoleKernel } from '@/Console/ConsoleKernel';
import { Application } from '@/Foundation/Application';
import * as indexExports from '@/index';

type CommandClass = new (...args: any[]) => Command;

/**
 * Every command class exported from src/index.ts (i.e. anything that extends
 * the abstract Command base class). The manifest must register each of them.
 *
 * Some exports (facades) are getters that throw until an app root is set,
 * so values are read defensively and unreadable exports skipped.
 */
function exportedCommandClasses(): CommandClass[] {
  const classes: CommandClass[] = [];

  for (const key of Object.keys(indexExports)) {
    try {
      const value = (indexExports as Record<string, unknown>)[key];
      if (typeof value === 'function' && (value as CommandClass).prototype instanceof Command) {
        classes.push(value as CommandClass);
      }
    } catch {
      // Facade exports are proxies that throw until a root is set; they are
      // never command classes, so unreadable exports are simply skipped.
    }
  }

  return classes;
}

/**
 * Kernel wired exactly like the CLI: registration comes solely from the manifest.
 */
class ManifestKernel extends ConsoleKernel {
  protected registerCommands(): void {
    this.registerMany([...coreCommands(this.app), ...deployCommands()]);
  }
}

describe('Command manifest', () => {
  const app = new Application('/test');
  const commands = [...coreCommands(app), ...deployCommands()];
  const registeredClasses = new Set(commands.map((command) => command.constructor));

  it('contains every command class exported from src/index.ts', () => {
    const missing = exportedCommandClasses()
      .filter((cls) => !registeredClasses.has(cls))
      .map((cls) => cls.name);
    expect(missing).toEqual([]);
  });

  it('registers each command exactly once', () => {
    const names = commands.map((command) => command.getName());
    expect(new Set(names).size).toBe(names.length);
    expect(registeredClasses.size).toBe(names.length);
  });

  it('does not list classes that are not exported command classes', () => {
    const exported = new Set<Function>(exportedCommandClasses());
    const manifestOnly = commands.map((command) => command.constructor).filter((cls) => !exported.has(cls));
    expect(manifestOnly).toEqual([]);
  });

  it('registers the queue, cache, job, and view commands', () => {
    const kernel = new ManifestKernel(app);
    const names = [...kernel.getCommands().keys()];

    expect(names).toEqual(
      expect.arrayContaining([
        'queue:work',
        'queue:listen',
        'queue:restart',
        'queue:failed',
        'queue:retry',
        'queue:forget',
        'queue:flush',
        'queue:clear',
        'queue:monitor',
        'queue:table',
        'queue:failed-table',
        'queue:batches-table',
        'queue:prune-batches',
        'queue:prune-failed',
        'cache:clear',
        'cache:forget',
        'cache:table',
        'make:job',
        'make:view',
      ])
    );
  });

  it('resolves newly reachable command classes to the right implementations', () => {
    const kernel = new ManifestKernel(app);
    const commandsByName = kernel.getCommands();

    expect(commandsByName.get('queue:work')?.constructor.name).toBe('QueueWorkCommand');
    expect(commandsByName.get('queue:listen')?.constructor.name).toBe('QueueListenCommand');
    expect(commandsByName.get('cache:clear')?.constructor.name).toBe('CacheClearCommand');
    expect(commandsByName.get('make:job')?.constructor.name).toBe('MakeJobCommand');
    expect(commandsByName.get('make:view')?.constructor.name).toBe('MakeViewCommand');
  });

  it('keeps deploy commands in a separate group embedders can omit', () => {
    const deploy = deployCommands();
    expect(deploy.map((command) => command.getName())).toEqual([
      'deploy:login',
      'deploy:init',
      'deploy:server',
      'deploy',
      'deploy:status',
      'deploy:env',
      'deploy:rollback',
      'deploy:provision',
    ]);

    const coreNames = coreCommands(app).map((command) => command.getName());
    expect(coreNames.filter((name) => name === 'deploy' || name.startsWith('deploy:'))).toEqual([]);
  });
});

describe('Command manifest smoke test', () => {
  it('handle() resolves queue:work instead of failing with "Command not found"', async () => {
    const kernel = new ManifestKernel(new Application('/test'));

    let error: Error | undefined;
    try {
      // No queue configuration is registered, so the command may fail later,
      // but it must resolve to the registered QueueWorkCommand.
      await kernel.handle('queue:work', [], { once: true });
    } catch (err) {
      error = err as Error;
    }

    expect(error === undefined || !error.message.includes('Command not found')).toBe(true);
  });

  it('run() lists queue, cache, job, and view commands with no arguments', async () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message));
    });

    try {
      const kernel = new ManifestKernel(new Application('/test'));
      await kernel.run(['node', 'orchestr']);
    } finally {
      spy.mockRestore();
    }

    const output = logs.join('\n');
    expect(output).toContain('queue:work');
    expect(output).toContain('cache:clear');
    expect(output).toContain('make:job');
    expect(output).toContain('make:view');
  });
});
