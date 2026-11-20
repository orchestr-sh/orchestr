import 'reflect-metadata';
import { describe, it, expect, beforeEach } from 'vitest';
import { Container } from '@/Container/Container';

/**
 * Contextual bindings: `when(consumer).needs(dependency).give(...)`.
 */

class Logger {}
class ConsoleLogger extends Logger {}
class FileLogger extends Logger {}

class ReportService {
  constructor(public logger: Logger) {}
}

class AuditService {
  constructor(public logger: Logger) {}
}

class ThresholdService {
  value: any;

  constructor(threshold: any) {
    this.value = threshold;
  }
}

class ReportCollector {
  items: any;

  constructor(reports: any) {
    this.items = reports;
  }
}

describe('Container contextual bindings', () => {
  let container: Container;

  beforeEach(() => {
    container = new Container();

    // Emulate what emitDecoratorMetadata records for decorated classes.
    Reflect.defineMetadata('design:paramtypes', [Logger], ReportService);
    Reflect.defineMetadata('design:paramtypes', [Logger], AuditService);
    Reflect.defineMetadata('design:paramtypes', [Object], ThresholdService);
    Reflect.defineMetadata('design:paramtypes', [Object], ReportCollector);
  });

  it('resolves the contextual implementation only for the consuming class', () => {
    container.bind(Logger, ConsoleLogger);
    container.when(ReportService).needs(Logger).give(FileLogger);

    const report = container.make<ReportService>(ReportService);
    const audit = container.make<AuditService>(AuditService);

    expect(report.logger).toBeInstanceOf(FileLogger);
    expect(audit.logger).toBeInstanceOf(ConsoleLogger);
    expect(container.make<Logger>(Logger)).toBeInstanceOf(ConsoleLogger);
  });

  it('accepts the class name as a string consumer and dependency', () => {
    container.bind(Logger, ConsoleLogger);
    container.when('ReportService').needs('Logger').give(FileLogger);

    expect(container.make<ReportService>(ReportService).logger).toBeInstanceOf(FileLogger);
    expect(container.make<AuditService>(AuditService).logger).toBeInstanceOf(ConsoleLogger);
  });

  it('never pollutes the shared instance the contextual build replaces', () => {
    container.singleton(Logger, ConsoleLogger);
    container.when(ReportService).needs(Logger).give(FileLogger);

    const shared = container.make<Logger>(Logger);
    const report = container.make<ReportService>(ReportService);

    expect(report.logger).toBeInstanceOf(FileLogger);
    expect(report.logger).not.toBe(shared);
    expect(container.make<Logger>(Logger)).toBe(shared);
  });

  it('builds contextual classes with their own dependencies injected', () => {
    class DetailedLogger {
      constructor(public inner: Logger) {}
    }
    Reflect.defineMetadata('design:paramtypes', [Logger], DetailedLogger);

    container.bind(Logger, ConsoleLogger);
    container.when(ReportService).needs(Logger).give(DetailedLogger);

    const report = container.make<ReportService>(ReportService);

    expect(report.logger).toBeInstanceOf(DetailedLogger);
    expect((report.logger as DetailedLogger).inner).toBeInstanceOf(ConsoleLogger);
  });

  it('supports closures and pre-built values as contextual implementations', () => {
    const madeByClosure = new FileLogger();
    container
      .when(ReportService)
      .needs(Logger)
      .give(() => madeByClosure);

    expect(container.make<ReportService>(ReportService).logger).toBe(madeByClosure);
  });

  it('applies contextual rules to every consumer listed in when()', () => {
    container.bind(Logger, ConsoleLogger);
    container.when([ReportService, AuditService]).needs(Logger).give(FileLogger);

    expect(container.make<ReportService>(ReportService).logger).toBeInstanceOf(FileLogger);
    expect(container.make<AuditService>(AuditService).logger).toBeInstanceOf(FileLogger);
  });

  it('gives primitives by $name', () => {
    class Configured {
      constructor(public threshold: any) {}
    }
    Reflect.defineMetadata('design:paramtypes', [Object], Configured);

    container.when(Configured).needs('$threshold').give(42);

    expect(container.make<Configured>(Configured).threshold).toBe(42);
  });

  it('giveTagged supplies every instance registered under the tag', () => {
    class ReportOne {}
    class ReportTwo {}
    container.bind(ReportOne, ReportOne);
    container.bind(ReportTwo, ReportTwo);
    container.tag([ReportOne, ReportTwo], 'reports');

    container.when(ReportCollector).needs('$reports').giveTagged('reports');

    const collector = container.make<ReportCollector>(ReportCollector);

    expect(collector.items).toHaveLength(2);
    expect(collector.items[0]).toBeInstanceOf(ReportOne);
    expect(collector.items[1]).toBeInstanceOf(ReportTwo);
  });

  it('giveConfig reads the value from the container config repository at resolution time', () => {
    container.instance('config', {
      get: (key: string) => (key === 'app.threshold' ? 99 : undefined),
    });

    container.when(ThresholdService).needs('$threshold').giveConfig('app.threshold');

    expect(container.make<ThresholdService>(ThresholdService).value).toBe(99);
  });

  it('lets an explicit parameter override beat the contextual binding', () => {
    container.bind(Logger, ConsoleLogger);
    container.when(ReportService).needs(Logger).give(FileLogger);

    const fallback = new ConsoleLogger();
    const report = container.makeWith<ReportService>(ReportService, { logger: fallback });

    expect(report.logger).toBe(fallback);
  });

  it('addContextualBinding registers without the fluent builder', () => {
    container.bind(Logger, ConsoleLogger);
    container.addContextualBinding(ReportService, Logger, FileLogger);

    expect(container.make<ReportService>(ReportService).logger).toBeInstanceOf(FileLogger);
  });
});
