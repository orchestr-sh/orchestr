/**
 * schedule:* console command tests
 *
 * Covers `schedule:run` (due-only execution and failure reporting),
 * `schedule:list` (expressions, descriptions, next run times),
 * `schedule:test` (immediate execution by name, unknown matches), and
 * `schedule:work` (the minute loop with a fake clock).
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ScheduleListCommand } from '@/Console/Commands/ScheduleListCommand';
import { ScheduleRunCommand } from '@/Console/Commands/ScheduleRunCommand';
import { ScheduleTestCommand } from '@/Console/Commands/ScheduleTestCommand';
import { ScheduleWorkCommand } from '@/Console/Commands/ScheduleWorkCommand';
import { Application } from '@/Foundation/Application';
import { Schedule } from '@/Scheduling/Schedule';

function at(year: number, month: number, day: number, hour = 0, minute = 0): Date {
  return new Date(year, month - 1, day, hour, minute);
}

/** Console output capture: collects stdout/stderr lines while fn runs */
async function captureOutput(fn: () => Promise<void>): Promise<{ out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];

  const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => void out.push(String(message)));
  const errorSpy = vi.spyOn(console, 'error').mockImplementation((message?: unknown) => void err.push(String(message)));

  try {
    await fn();
  } finally {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  }

  return { out, err };
}

describe('schedule:run', () => {
  it('executes only the tasks that are due', async () => {
    // Thursday Nov 12 2026 at 09:00 local time.
    vi.useFakeTimers();

    try {
      vi.setSystemTime(at(2026, 11, 12, 9, 0));

      const app = new Application('/test');
      const schedule = new Schedule(app);
      app.instance('schedule', schedule);

      let morningRuns = 0;
      let nightlyRuns = 0;

      schedule.call(() => morningRuns++, 'morning task').everyMinute();
      schedule.call(() => nightlyRuns++, 'nightly task').dailyAt('02:30');

      const command = new ScheduleRunCommand(app);
      const { err } = await captureOutput(() => command.handle([], {}));

      expect(morningRuns).toBe(1);
      expect(nightlyRuns).toBe(0);
      expect(err).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports failed tasks on the error stream', async () => {
    vi.useFakeTimers();

    try {
      vi.setSystemTime(at(2026, 11, 12, 9, 0));

      const app = new Application('/test');
      const schedule = new Schedule(app);
      app.instance('schedule', schedule);

      schedule
        .call(() => {
          throw new Error('disk full');
        }, 'broken task')
        .everyMinute();

      const command = new ScheduleRunCommand(app);
      const { err } = await captureOutput(() => command.handle([], {}));

      expect(err.join('\n')).toContain('broken task');
      expect(err.join('\n')).toContain('disk full');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('schedule:list', () => {
  it('shows each task with its expression and next run time', async () => {
    vi.useFakeTimers();

    try {
      vi.setSystemTime(at(2026, 11, 12, 9, 0));

      const app = new Application('/test');
      const schedule = new Schedule(app);
      app.instance('schedule', schedule);

      schedule.call(() => undefined, 'nightly backup').dailyAt('01:30');
      schedule.command('report:send').weeklyOn(1, '09:00');

      const command = new ScheduleListCommand(app);
      const { out } = await captureOutput(() => command.handle([], {}));

      const output = out.join('\n');

      expect(output).toContain('30 1 * * *  nightly backup');
      expect(output).toContain('next run date[2026-11-13 01:30:00]');
      expect(output).toContain('0 9 * * 1  Command "report:send"');
      expect(output).toContain('next run date[2026-11-16 09:00:00]');
    } finally {
      vi.useRealTimers();
    }
  });

  it('says so when no tasks are registered', async () => {
    const app = new Application('/test');
    app.instance('schedule', new Schedule(app));

    const command = new ScheduleListCommand(app);
    const { out } = await captureOutput(() => command.handle([], {}));

    expect(out.join('\n')).toContain('No scheduled tasks have been defined.');
  });
});

describe('schedule:test', () => {
  it('runs a matching task immediately, even when it is not due', async () => {
    const app = new Application('/test');
    const schedule = new Schedule(app);
    app.instance('schedule', schedule);

    let runs = 0;
    schedule.call(() => runs++, 'nightly backup').dailyAt('01:30');

    const command = new ScheduleTestCommand(app);
    const { out, err } = await captureOutput(() => command.handle(['backup'], {}));

    expect(runs).toBe(1);
    expect(out.join('\n')).toContain('Running [nightly backup]...');
    expect(out.join('\n')).toContain('Task completed.');
    expect(err).toEqual([]);
  });

  it('errors for unknown and ambiguous searches without running anything', async () => {
    const app = new Application('/test');
    const schedule = new Schedule(app);
    app.instance('schedule', schedule);

    let runs = 0;
    schedule.call(() => runs++, 'task alpha').everyMinute();
    schedule.call(() => runs++, 'task beta').everyMinute();

    const command = new ScheduleTestCommand(app);

    const unknown = await captureOutput(() => command.handle(['gamma'], {}));
    expect(unknown.err.join('\n')).toContain('does not contain a task matching [gamma]');

    const ambiguous = await captureOutput(() => command.handle(['task'], {}));
    expect(ambiguous.err.join('\n')).toContain('Multiple scheduled tasks match');

    expect(runs).toBe(0);
  });

  it('lists the candidates when no task is given', async () => {
    const app = new Application('/test');
    const schedule = new Schedule(app);
    app.instance('schedule', schedule);

    schedule.call(() => undefined, 'nightly backup').everyMinute();

    const command = new ScheduleTestCommand(app);
    const { out } = await captureOutput(() => command.handle([], {}));

    expect(out.join('\n')).toContain('nightly backup');
  });
});

describe('schedule:work', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('loops the scheduler once per minute until stopped', async () => {
    vi.useFakeTimers();

    const app = new Application('/test');
    const schedule = new Schedule(app);
    app.instance('schedule', schedule);

    let runs = 0;
    schedule.call(() => runs++, 'tick counter').everyMinute();

    const command = new ScheduleWorkCommand(app);
    const output = captureOutput(() => command.handle([], {}));

    // First minute: loop iteration one runs immediately.
    await vi.advanceTimersByTimeAsync(10);
    expect(runs).toBe(1);

    // Second minute boundary.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(runs).toBe(2);

    command.stop();
    await vi.advanceTimersByTimeAsync(2_000);

    await output;
    expect(runs).toBe(2);
  });
});
