import 'reflect-metadata';
import { describe, it, expect, beforeEach } from 'vitest';
import { Container } from '@/Container/Container';

class Logger {
  id = 'logger';
}
class FileLogger extends Logger {
  id = 'file-logger';
}

class Controller {
  store(logger: any, note = 'default') {
    return { logger, note };
  }

  static handle(logger: any) {
    return { static: true, logger };
  }
}

class Invokable {
  __invoke(logger: any, extra = 'none') {
    return { logger, extra };
  }
}

describe('Container callable injection', () => {
  let container: Container;

  beforeEach(() => {
    container = new Container();

    Reflect.defineMetadata('design:paramtypes', [Logger], Controller.prototype, 'store');
    Reflect.defineMetadata('design:paramtypes', [Logger], Controller, 'handle');
    Reflect.defineMetadata('design:paramtypes', [Logger], Invokable.prototype, '__invoke');

    container.bind(Logger, Logger);
    container.bind('Controller', Controller);
    container.bind('Invokable', Invokable);
  });

  describe('closures', () => {
    it('resolves dependencies by reflected type', () => {
      const fn = (logger: Logger) => logger.id;
      Reflect.defineMetadata('design:paramtypes', [Logger], fn);

      expect(container.call(fn)).toBe('logger');
    });

    it('honours positional explicit parameters (legacy shape)', () => {
      expect(container.call((first: any, second: any) => `${first}-${second}`, ['a', 'b'])).toBe('a-b');
    });

    it('honours named explicit parameters including null', () => {
      const fn = (threshold: any) => threshold ?? 'defaulted';

      expect(container.call(fn, { threshold: null })).toBe('defaulted');
      expect(container.call(fn, { threshold: 7 })).toBe(7);
    });
  });

  describe('class@method strings and tuples', () => {
    it('resolves Controller@method strings through the container', () => {
      const result = container.call<{ logger: Logger; note: string }>('Controller@store');

      expect(result.logger).toBeInstanceOf(Logger);
      expect(result.note).toBe('default');
    });

    it('accepts [Class, method] tuples, constructing the class via the container', () => {
      const result = container.call<{ logger: Logger }>([Controller, 'store']);

      expect(result.logger).toBeInstanceOf(Logger);
    });

    it('accepts [instance, method] tuples', () => {
      const controller = new Controller();
      const result = container.call<{ logger: Logger }>([controller, 'store']);

      expect(result.logger).toBeInstanceOf(Logger);
    });

    it('supports static methods through [Class, method]', () => {
      const result = container.call<{ logger: Logger; static: boolean }>([Controller, 'handle']);

      expect(result.static).toBe(true);
      expect(result.logger).toBeInstanceOf(Logger);
    });

    it('substitutes named parameters on methods and keeps defaults', () => {
      const explicit = new Logger();
      const result = container.call<{ logger: Logger; note: string }>('Controller@store', {
        logger: explicit,
        note: 'passed',
      });

      expect(result.logger).toBe(explicit);
      expect(result.note).toBe('passed');

      const defaulted = container.call<{ logger: Logger; note: string }>('Controller@store', {
        logger: explicit,
      });

      expect(defaulted.note).toBe('default');
    });

    it('throws for missing methods', () => {
      expect(() => container.call('Controller@missing')).toThrow('Method [missing] does not exist.');
    });

    it('throws for bare class strings without an __invoke method', () => {
      expect(() => container.call('Controller')).toThrow('Target [Controller] is not callable.');
    });
  });

  describe('class strings and __invoke', () => {
    it('invokes the __invoke method of a bare class string', () => {
      const result = container.call<{ logger: Logger; extra: string }>('Invokable');

      expect(result.logger).toBeInstanceOf(Logger);
      expect(result.extra).toBe('none');
    });

    it('supports objects exposing __invoke', () => {
      const target = {
        ran: false,
        __invoke() {
          this.ran = true;
        },
      };

      container.call(target);

      expect(target.ran).toBe(true);
    });

    it('uses defaultMethod for class strings without __invoke', () => {
      class Handler {
        handle(logger: Logger) {
          return logger.id;
        }
      }
      Reflect.defineMetadata('design:paramtypes', [Logger], Handler.prototype, 'handle');
      container.bind('Handler', Handler);

      expect(container.call('Handler', {}, 'handle')).toBe('logger');
    });
  });

  describe('method-level contextual bindings', () => {
    it('gives method parameters the consumer-contextual implementation', () => {
      container.when(Controller).needs(Logger).give(FileLogger);

      const result = container.call<{ logger: Logger }>('Controller@store');

      expect(result.logger.id).toBe('file-logger');
    });

    it('resolves primitives in methods by $name', () => {
      class Reporter {
        constructor(public logger: any) {}

        publish(retries: any) {
          return retries;
        }
      }
      Reflect.defineMetadata('design:paramtypes', [Logger], Reporter);
      Reflect.defineMetadata('design:paramtypes', [Object], Reporter.prototype, 'publish');
      container.bind(Reporter, Reporter);

      container.when(Reporter).needs('$retries').give(3);

      const reporter = container.make<Reporter>(Reporter);

      expect(reporter.publish(undefined)).toBeUndefined();
      expect(container.call([Reporter, 'publish'])).toBe(3);
    });
  });

  describe('defaults and nullable dependencies', () => {
    it('passes nothing into defaulted parameters, letting the declaration fill in', () => {
      class WithDefaults {
        constructor(
          public missing: any = 'fallback',
          public logger: any = 'untouched'
        ) {}
      }
      Reflect.defineMetadata('design:paramtypes', [Object, Logger], WithDefaults);

      const instance = container.make<WithDefaults>(WithDefaults);

      expect(instance.missing).toBe('fallback');
      expect(instance.logger).toBeInstanceOf(Logger);
    });

    it('resolves a nullable-style dependency from its = null default', () => {
      class Optional {
        constructor(public maybe: any = null) {}
      }
      Reflect.defineMetadata('design:paramtypes', [Object], Optional);

      expect(container.make<Optional>(Optional).maybe).toBeNull();
    });

    it('lets a bound contextual value beat a default', () => {
      class OptionalWithBind {
        constructor(public maybe: any = null) {}
      }
      Reflect.defineMetadata('design:paramtypes', [Logger], OptionalWithBind);

      const logger = new Logger();
      container.bind(Logger, () => logger);

      expect(container.make<OptionalWithBind>(OptionalWithBind).maybe).toBe(logger);
    });
  });

  describe('unresolvable arguments', () => {
    it('keeps the current error message for reflected primitives', () => {
      const fn = (value: any) => value;
      Reflect.defineMetadata('design:paramtypes', [String], fn);

      expect(() => container.call(fn)).toThrow(
        'Cannot resolve dependency at position 0 for fn. ' +
          'Make sure TypeScript decorators are enabled and the class has proper type hints.'
      );
    });

    it('names the owning method for method injection failures', () => {
      class BadMethod {
        run(value: any) {
          return value;
        }
      }
      Reflect.defineMetadata('design:paramtypes', [Number], BadMethod.prototype, 'run');

      expect(() => container.call([BadMethod, 'run'])).toThrow(
        'Cannot resolve dependency at position 0 for BadMethod.run.'
      );
    });
  });
});
