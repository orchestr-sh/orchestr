/**
 * Maintenance mode commands - `down` and `up`
 *
 * Covers the recorded state (message, retry, secret, render), the shared
 * Application surface every consumer reads - isDownForMaintenance() and
 * maintenanceMode() - and the round trip back to normal operation. The
 * destructive parts touch only a temporary storage directory.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DownCommand } from '@/Console/Commands/DownCommand';
import { UpCommand } from '@/Console/Commands/UpCommand';
import { ConsoleKernel } from '@/Console/ConsoleKernel';
import { Application } from '@/Foundation/Application';

function captureOutput(): { logs: string[]; errors: string[]; restore: () => void } {
  const logs: string[] = [];
  const errors: string[] = [];

  const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => void logs.push(String(message)));
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation((message?: unknown) => void logs.push(String(message)));
  const errorSpy = vi
    .spyOn(console, 'error')
    .mockImplementation((message?: unknown) => void errors.push(String(message)));

  return {
    logs,
    errors,
    restore: () => {
      logSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    },
  };
}

let base: string;
let app: Application;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'orchestr-maintenance-commands-'));
  app = new Application(base);
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

function downFile(): string {
  return join(base, 'storage', 'framework', 'down');
}

describe('down', () => {
  it('records the plain maintenance state', async () => {
    const output = captureOutput();

    try {
      await new DownCommand(app).handle();
    } finally {
      output.restore();
    }

    expect(existsSync(downFile())).toBe(true);
    expect(app.isDownForMaintenance()).toBe(true);
    expect(output.logs.join('\n')).toContain('Application now in maintenance mode.');
  });

  it('records the message, retry, secret and render options', async () => {
    const output = captureOutput();

    try {
      await new DownCommand(app).handle([], {
        message: 'Back soon',
        retry: '120',
        secret: 'topsecret',
        render: 'errors.503',
      });
    } finally {
      output.restore();
    }

    const data = JSON.parse(readFileSync(downFile(), 'utf8'));

    expect(data).toMatchObject({ message: 'Back soon', retry: 120, secret: 'topsecret', render: 'errors.503' });
    expect(typeof data.time).toBe('number');
    expect(app.maintenanceMode().data().message).toBe('Back soon');
    expect(app.maintenanceMode().hasSecret()).toBe(true);
  });

  it('points visitors at the secret bypass when one is recorded', async () => {
    const output = captureOutput();

    try {
      await new DownCommand(app).handle([], { secret: 'topsecret' });
    } finally {
      output.restore();
    }

    expect(output.logs.join('\n')).toContain('topsecret');
  });

  it('rejects a non-numeric retry without writing state', async () => {
    const output = captureOutput();

    try {
      await new DownCommand(app).handle([], { retry: 'noonan' });
    } finally {
      output.restore();
    }

    expect(output.errors.join('\n')).toContain('retry');
    expect(existsSync(downFile())).toBe(false);
    expect(app.isDownForMaintenance()).toBe(false);
  });

  it('creates the storage framework directory when it is missing', async () => {
    const output = captureOutput();

    try {
      await new DownCommand(app).handle([], { message: 'Fresh directory' });
    } finally {
      output.restore();
    }

    expect(JSON.parse(readFileSync(downFile(), 'utf8')).message).toBe('Fresh directory');
  });
});

describe('up', () => {
  it('clears the maintenance state', async () => {
    await new DownCommand(app).handle([], { message: 'Temporary' });

    const output = captureOutput();

    try {
      await new UpCommand(app).handle();
    } finally {
      output.restore();
    }

    expect(existsSync(downFile())).toBe(false);
    expect(app.isDownForMaintenance()).toBe(false);
    expect(app.maintenanceMode().data()).toEqual({});
    expect(output.logs.join('\n')).toContain('Application is now live.');
  });

  it('succeeds when the application was not down', async () => {
    const output = captureOutput();

    try {
      await new UpCommand(app).handle();
    } finally {
      output.restore();
    }

    expect(output.errors).toEqual([]);
    expect(output.logs.join('\n')).toContain('Application is now live.');
  });
});

describe('Application maintenance mode surface', () => {
  it('reads an externally created (decommissioned) down file as active', () => {
    mkdirSync(join(base, 'storage', 'framework'), { recursive: true });
    writeFileSync(downFile(), '');

    expect(app.isDownForMaintenance()).toBe(true);
    expect(app.maintenanceMode().active()).toBe(true);
    expect(app.maintenanceMode().decommissioned()).toBe(true);
    expect(app.maintenanceMode().data()).toEqual({});
  });

  it('treats unparsable down file contents as no recorded data', () => {
    mkdirSync(join(base, 'storage', 'framework'), { recursive: true });
    writeFileSync(downFile(), 'plain text');

    expect(app.maintenanceMode().data()).toEqual({});
    expect(app.maintenanceMode().hasSecret()).toBe(false);
  });

  it('activate/deactivate round-trips the recorded data', () => {
    app.maintenanceMode().activate({ message: 'Halfway there', retry: 30, secret: 'abc' });

    expect(app.maintenanceMode().data()).toMatchObject({ message: 'Halfway there', retry: 30, secret: 'abc' });

    app.maintenanceMode().deactivate();

    expect(app.isDownForMaintenance()).toBe(false);
  });
});

describe('maintenance commands through the console kernel', () => {
  class MaintenanceKernel extends ConsoleKernel {
    protected registerCommands(): void {
      this.registerMany([new DownCommand(this.app), new UpCommand(this.app)]);
    }
  }

  it('parses the signature options and restores normal operation', async () => {
    const kernel = new MaintenanceKernel(app);
    const output = captureOutput();

    try {
      await kernel.handle('down', [], { message: 'Kernel driven', retry: '90' });

      expect(app.isDownForMaintenance()).toBe(true);
      expect(app.maintenanceMode().data()).toMatchObject({ message: 'Kernel driven', retry: 90 });

      await kernel.handle('up');

      expect(app.isDownForMaintenance()).toBe(false);
    } finally {
      output.restore();
    }
  });
});
