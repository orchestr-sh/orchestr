/**
 * Schedule manager tests
 *
 * Covers due-event selection and execution with a fake clock, all four
 * task types (closure, console command, queued job, shell exec), group()
 * registration, maintenance-mode skipping, background runs, and the
 * cache-lock behaviour behind withoutOverlapping()/onOneServer().
 */

import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { CacheManager } from '@/Cache/CacheManager';
import { CacheServiceProvider } from '@/Cache/CacheServiceProvider';
import { Command, CommandOptions } from '@/Console/Command';
import { ConsoleKernel } from '@/Console/ConsoleKernel';
import { Application } from '@/Foundation/Application';
import { Job } from '@/Queue/Job';
import { Schedule } from '@/Scheduling/Schedule';
import { QueueFake } from '@/Support/Testing/Fakes/QueueFake';

/** Local-time date builder: month is 1-based for readable tests */
function at(year: number, month: number, day: number, hour = 0, minute = 0): Date {
  return new Date(year, month - 1, day, hour, minute);
}

const DUE_NOW = at(2026, 11, 12, 9, 0);

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function cacheApp(basePath?: string): Application {
  const app = new Application(basePath ?? '/test-schedule');

  app.instance('config', {
    items: {
      cache: {
        default: 'array',
        prefix: 'app_',
        stores: { array: { driver: 'array', serialize: false } },
      },
    },
  });

  app.register(new CacheServiceProvider(app));

  return app;
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 30; i++) {
    await Promise.resolve();
  }
}

describe('Schedule registration and due selection', () => {
  it('selects only the events whose expressions pass at the given moment', () => {
    const schedule = new Schedule();

    const due = schedule.call(() => undefined, 'morning task').everyMinute();
    schedule.call(() => undefined, 'nightly task').dailyAt('02:00');

    expect(schedule.dueEvents(DUE_NOW)).toEqual([due]);
  });

  it('runs due events and reports their outcomes', async () => {
    const schedule = new Schedule();

    const calls: Date[] = [];
    schedule.call((now) => calls.push(now), 'clock watcher').everyMinute();
    schedule.call(() => undefined, 'nightly').dailyAt('02:00');

    const results = await schedule.run(DUE_NOW);

    expect(results).toHaveLength(1);
    expect(results[0].outcome).toEqual({ status: 'success' });
    expect(results[0].event.getDescription()).toBe('clock watcher');
    expect(calls.length).toBe(1);
    expect(calls[0]).toBeInstanceOf(Date);
  });

  it('merges events registered through group()', () => {
    const schedule = new Schedule();

    schedule.group((group) => {
      group.call(() => undefined, 'grouped one').everyMinute();
      group.call(() => undefined, 'grouped two').hourly();
    });

    expect(schedule.events).toHaveLength(2);
    expect(schedule.events.map((event) => event.getDescription())).toEqual(['grouped one', 'grouped two']);
  });
});

describe('Schedule task types', () => {
  it('runs console commands through the container-bound kernel', async () => {
    const app = cacheApp();
    const handled: Array<{ args: string[]; options: CommandOptions }> = [];

    class HelloCommand extends Command {
      signature = 'dummy:hello';
      description = 'Dummy command for scheduling tests';

      async handle(args: string[], options: CommandOptions): Promise<void> {
        handled.push({ args, options });
      }
    }

    const kernel = new ConsoleKernel(app);
    kernel.register(new HelloCommand());

    const schedule = new Schedule(app);
    schedule.command('dummy:hello', { name: 'World', force: true }).everyMinute();

    const results = await schedule.run(DUE_NOW);

    expect(results[0].outcome).toEqual({ status: 'success' });
    expect(handled).toEqual([{ args: [], options: { name: 'World', force: true } }]);
    expect(schedule.events[0].getDescription()).toBe('Command "dummy:hello --name=World --force"');
  });

  it('fails scheduled console commands for unknown names', async () => {
    const app = cacheApp();

    new ConsoleKernel(app);

    const schedule = new Schedule(app);
    const event = schedule.command('does:not-exist').everyMinute();

    const failures: unknown[] = [];
    event.onFailure((error) => {
      failures.push(error);
    });

    const results = await schedule.run(DUE_NOW);

    expect(results[0].outcome.status).toBe('failure');
    expect(failures).toHaveLength(1);
    expect(String((failures[0] as Error).message)).toContain('Command not found');
  });

  it('dispatches scheduled jobs onto the queue', async () => {
    const app = cacheApp();
    const queue = new QueueFake();
    app.instance('queue', queue);

    class ReportJob extends Job {
      async handle(): Promise<void> {}
    }

    const schedule = new Schedule(app);
    schedule.job(new ReportJob()).everyMinute();
    schedule.job(ReportJob, []).everyMinute();

    const results = await schedule.run(DUE_NOW);

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.outcome.status === 'success')).toBe(true);
    expect(queue.pushedJobs).toHaveLength(2);
    expect(queue.pushedJobs[0].job).toBeInstanceOf(ReportJob);
    expect(queue.pushedJobs[1].job).toBeInstanceOf(ReportJob);
    expect(schedule.events[0].getDescription()).toBe('Job "ReportJob"');
  });

  it('runs shell commands and surfaces failures', async () => {
    const base = tempDir('orchestr-schedule-exec-');

    try {
      const marker = join(base, 'exec-marker');
      const schedule = new Schedule();

      const ok = await schedule.exec(`touch ${marker}`).everyMinute().run();
      expect(ok).toEqual({ status: 'success' });
      expect(existsSync(marker)).toBe(true);

      const failed = await schedule.exec('exit 7').everyMinute().run();

      if (failed.status !== 'failure') {
        throw new Error('expected exec failure outcome');
      }

      expect((failed.error as Error).message).toContain('exit 7');
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('passes the app base path as the cwd for exec tasks', async () => {
    const base = tempDir('orchestr-schedule-cwd-');
    writeFileSync(join(base, 'cwd-marker'), 'ok');

    try {
      const app = new Application(base);
      const schedule = new Schedule(app);

      const outcome = await schedule.exec('cat cwd-marker').everyMinute().run();

      expect(outcome).toEqual({ status: 'success' });
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

describe('Schedule maintenance mode', () => {
  it('skips events without evenInMaintenanceMode while storage/framework/down exists', async () => {
    const base = tempDir('orchestr-schedule-maintenance-');

    try {
      mkdirSync(join(base, 'storage', 'framework'), { recursive: true });
      writeFileSync(join(base, 'storage', 'framework', 'down'), JSON.stringify({ down: true }));

      const app = new Application(base);
      const schedule = new Schedule(app);

      let normal = 0;
      let agnostic = 0;

      schedule.call(() => normal++, 'normal task').everyMinute();
      schedule
        .call(() => agnostic++, 'maintenance-proof task')
        .everyMinute()
        .evenInMaintenanceMode();

      expect(schedule.inMaintenanceMode()).toBe(true);

      const results = await schedule.run(DUE_NOW);

      expect(results).toHaveLength(1);
      expect(normal).toBe(0);
      expect(agnostic).toBe(1);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

describe('Schedule background runs', () => {
  it('does not await runInBackground events', async () => {
    const schedule = new Schedule();

    let finished = false;
    let release: (() => void) | undefined;

    let started = false;

    schedule
      .call(() => {
        started = true;

        return new Promise<void>((resolve) => {
          release = resolve;
        }).then(() => {
          finished = true;
        });
      }, 'slow background task')
      .everyMinute()
      .runInBackground();

    const results = await schedule.run(DUE_NOW);

    // The background event was started but deliberately not awaited.
    expect(results).toHaveLength(0);
    expect(started).toBe(true);
    expect(finished).toBe(false);

    release!();
    await flushMicrotasks();

    expect(finished).toBe(true);
  });
});

describe('Schedule mutexes with the cache store', () => {
  it('withoutOverlapping prevents concurrent runs and releases when done', async () => {
    const app = cacheApp();
    const scheduleA = new Schedule(app);
    const scheduleB = new Schedule(app);

    const releases: Array<() => void> = [];
    let runs = 0;

    const slowTask = async (): Promise<void> => {
      runs++;
      await new Promise<void>((resolve) => releases.push(resolve));
    };

    const eventA = scheduleA.call(slowTask, 'contended').everyMinute().withoutOverlapping();
    scheduleB.call(slowTask, 'contended').everyMinute().withoutOverlapping();

    const first = scheduleA.run(DUE_NOW);
    await flushMicrotasks();

    // A second process with its own schedule instance is blocked.
    const second = await scheduleB.run(DUE_NOW);

    expect(second).toHaveLength(1);
    expect(second[0].outcome).toEqual({ status: 'skipped', reason: 'mutex' });
    expect(runs).toBe(1);

    // The mutex lives in the shared cache, not in the schedule instance.
    const cache = app.make<CacheManager>('cache');
    expect(await cache.lock(eventA.mutexName(), 1).get()).toBe(false);

    releases.shift()!();
    expect((await first)[0].outcome).toEqual({ status: 'success' });

    // Released on completion: the lock is free again for a fresh taker.
    const probe = cache.lock(eventA.mutexName(), 1);
    expect(await probe.get()).toBe(true);
    await probe.release();

    // ... and the next cycle runs for real.
    const third = scheduleB.run(DUE_NOW);
    await flushMicrotasks();

    expect(runs).toBe(2);

    releases.shift()!();
    expect((await third)[0].outcome).toEqual({ status: 'success' });
  });

  it('onOneServer keeps the cache lock so only one server runs the event', async () => {
    const app = cacheApp();
    const scheduleA = new Schedule(app);
    const scheduleB = new Schedule(app);

    let serverARuns = 0;
    let serverBRuns = 0;

    const eventA = scheduleA
      .call(() => serverARuns++, 'clustered task')
      .everyMinute()
      .onOneServer();
    scheduleB
      .call(() => serverBRuns++, 'clustered task')
      .everyMinute()
      .onOneServer();

    const resultsA = await scheduleA.run(DUE_NOW);

    expect(resultsA[0].outcome).toEqual({ status: 'success' });
    expect(serverARuns).toBe(1);

    const resultsB = await scheduleB.run(DUE_NOW);

    expect(resultsB[0].outcome).toEqual({ status: 'skipped', reason: 'mutex' });
    expect(serverBRuns).toBe(0);

    // The winning server holds a real cache lock under the mutex name.
    const cache = app.make<CacheManager>('cache');
    expect(await cache.lock(eventA.mutexName(), 1).get()).toBe(false);
  });

  it('onOneServer lets the owning schedule re-acquire its own held lock', async () => {
    const app = cacheApp();
    const schedule = new Schedule(app);

    let runs = 0;
    schedule
      .call(() => runs++, 'owning server task')
      .everyMinute()
      .onOneServer();

    await schedule.run(DUE_NOW);
    await schedule.run(at(2026, 11, 12, 9, 1));

    expect(runs).toBe(2);
  });
});
