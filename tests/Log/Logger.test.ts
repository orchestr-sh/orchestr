/**
 * Logger public surface
 *
 * The logging classes shipped in #55 were not reachable from any package
 * entry point. This test is the regression pin for the exports in
 * src/index.ts - it builds a working logger purely through the public API:
 * a Logger writing through any object that satisfies the LogHandler
 * contract, with LineFormatter deciding the presentation.
 */

import { describe, it, expect } from 'vitest';
import { Logger, LineFormatter, LOG_LEVELS, levelNumber, isLogLevel, type LogHandler, type LogRecord } from '@/index';

class MemoryHandler implements LogHandler {
  lines: string[] = [];
  records: LogRecord[] = [];
  formatter = new LineFormatter();

  handle(record: LogRecord): void {
    this.records.push(record);
    this.lines.push(this.formatter.format(record));
  }

  close(): void {
    // nothing to release
  }
}

describe('logging exports', () => {
  it('interpolates PSR-3 placeholders and honours the threshold', () => {
    const handler = new MemoryHandler();
    const logger = new Logger(handler, { level: 'info', name: 'app', channel: 'single' });

    logger.debug('never seen');
    logger.info('user {id} signed in', { id: 1 });

    expect(handler.records.map((record) => record.level)).toEqual(['info']);
    expect(handler.lines[0]).toMatch(/app\.INFO: user 1 signed in \{"id":1\}\n$/);
  });

  it('derives scoped loggers without mutating the parent', () => {
    const handler = new MemoryHandler();
    const base = new Logger(handler, { name: 'app' });
    const billing = base.withName('billing').withContext({ tenant: 9 });

    billing.error('charge failed');

    expect(base.getName()).toBe('app');
    expect(handler.records[0].name).toBe('billing');
    expect(handler.records[0].context).toEqual({ tenant: 9 });
  });

  it('exposes the level helpers', () => {
    expect(isLogLevel('warning')).toBe(true);
    expect(isLogLevel('nope')).toBe(false);
    expect(levelNumber('error')).toBe(LOG_LEVELS.error);
  });

  it('refuses channel switches without a resolver', () => {
    const logger = new Logger(new MemoryHandler());
    expect(() => logger.withChannel('daily')).toThrow(/channel resolver/);
  });
});
