/**
 * QueueListenCommand unit tests
 *
 * Covers the pure parts of the listener: building the queue:work child
 * argv (connection + forwarded worker options) and resolving the
 * restart-on-change watch directories. The supervision loop itself spawns
 * child processes and is exercised manually via `orchestr queue:listen`.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { QueueListenCommand } from '@/Console/Commands/QueueListenCommand';
import { Application } from '@/Foundation/Application';

describe('QueueListenCommand', () => {
  let command: QueueListenCommand;

  beforeAll(() => {
    const app = new Application('/test');
    command = new QueueListenCommand(app);
  });

  it('has the queue:listen signature and a description', () => {
    expect(command.getName()).toBe('queue:listen');
    expect(command.description.length).toBeGreaterThan(0);
  });

  it('builds a queue:work child argv with the connection and forwarded options', () => {
    const argv = command.buildChildArgv(['node', '/app/cli.mjs'], 'redis', {
      queue: 'high,default',
      tries: '3',
      sleep: 2,
      'max-jobs': '10',
      force: true,
      once: true, // queue:listen never forwards --once
      verbose: true, // unknown to queue:work; dropped
    });

    expect(argv).toEqual([
      '/app/cli.mjs',
      'queue:work',
      'redis',
      '--queue=high,default',
      '--sleep=2',
      '--tries=3',
      '--max-jobs=10',
      '--force',
    ]);
  });

  it('honours an explicit --command entry override', () => {
    const argv = command.buildChildArgv(['node', '/whatever.mjs'], 'default', {
      command: '/app/artisan-like.mjs',
    });

    expect(argv[0]).toBe('/app/artisan-like.mjs');
    expect(argv[1]).toBe('queue:work');
  });

  it('throws a helpful error when no CLI entry can be determined', () => {
    expect(() => command.buildChildArgv(['node', undefined as any], 'default', {})).toThrow(
      /Unable to determine the CLI entry/
    );
  });

  it('resolves watch directories, keeping only those that exist', () => {
    const existing = mkdtempSync(join(tmpdir(), 'orchestr-watch-'));

    try {
      const dirs = (command as any).resolveWatchDirs({
        watch: `${existing},/definitely/not/here`,
      }) as string[];

      expect(dirs).toEqual([existing]);
    } finally {
      rmSync(existing, { recursive: true, force: true });
    }
  });

  it('defaults to watching src and disables watching with --no-watch', () => {
    const defaultDirs = (command as any).resolveWatchDirs({ watch: true }) as string[];

    // vitest runs from the repo root, which contains src/
    expect(defaultDirs).toEqual([join(process.cwd(), 'src')]);

    expect((command as any).resolveWatchDirs({})).toEqual([]);
    expect((command as any).resolveWatchDirs({ watch: false })).toEqual([]);
    expect((command as any).resolveWatchDirs({ watch: 'false' })).toEqual([]);
  });
});
