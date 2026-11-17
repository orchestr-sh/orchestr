/**
 * InteractsWithExceptionHandling
 *
 * Turns the application's exception handling off and back on, and declares
 * the exception a request is expected to surface. With handling disabled
 * the original exception bubbles out of the kernel instead of being
 * rendered - the behaviour
 * Illuminate\Foundation\Testing\Concerns\InteractsWithExceptionHandling
 * provides.
 */

import type { Request } from '@/Routing/Request';
import type { Response } from '@/Routing/Response';
import type { TestApplicationConstructor } from '@/Testing/contracts';
import type { ExceptionExpectation } from '@/Testing/TestClient';
import { EXCEPTION_HANDLER_BINDING, Handler } from '@/Foundation/Exceptions/Handler';
import { NotFoundHttpException } from '@/Foundation/Exceptions/NotFoundHttpException';

/**
 * A handler that reports nothing and renders nothing: every exception is
 * rethrown so the test sees it. Exceptions named in `except` keep their
 * normal rendering - by default that is the 404s Laravel also lets
 * through.
 */
export class ThrowingHandler extends Handler {
  constructor(
    app: any,
    readonly except: Array<new (...args: any[]) => Error> = []
  ) {
    super(app);
  }

  /**
   * Rethrow the exception instead of rendering it
   */
  override async handle(request: Request, error: unknown, response: Response): Promise<void> {
    if (this.except.some((type) => error instanceof type)) {
      return super.handle(request, error, response);
    }

    if (response.finished) {
      return;
    }

    throw error;
  }

  /**
   * Nothing is reported while handling is disabled
   */
  override report(_error: unknown): void {
    // intentionally silent: the exception surfaces in the test instead
  }

  /**
   * Rethrow rather than render when used as a plain renderer
   */
  override render(request: Request, error: unknown): any {
    if (this.except.some((type) => error instanceof type)) {
      return super.render(request, error);
    }

    throw error;
  }
}

export function InteractsWithExceptionHandling<T extends TestApplicationConstructor>(Base: T) {
  abstract class InteractsWithExceptionHandlingMixin extends Base {
    /**
     * Exception constructors the next requests are expected to throw, in
     * registration order
     */
    expectedExceptions: Array<new (...args: any[]) => Error> = [];

    /**
     * Whether an exception handling expectation is currently armed
     */
    hasExpectedException(): boolean {
      return this.expectedExceptions.length > 0;
    }

    /**
     * Disable exception handling: requests rethrow whatever the route
     * raises. 404s keep rendering by default, matching Laravel.
     * Laravel: withoutExceptionHandling
     */
    withoutExceptionHandling(except: Array<new (...args: any[]) => Error> = [NotFoundHttpException]): this {
      this.app.instance(EXCEPTION_HANDLER_BINDING, new ThrowingHandler(this.app, except));

      this.kernel.forgetExceptionHandler();
      this.router.forgetExceptionHandler();

      return this;
    }

    /**
     * Restore normal exception handling
     * Laravel: withExceptionHandling
     */
    withExceptionHandling(): this {
      this.app.instance(EXCEPTION_HANDLER_BINDING, new Handler(this.app));

      this.kernel.forgetExceptionHandler();
      this.router.forgetExceptionHandler();

      return this;
    }

    /**
     * Assert the next request throws this exception. The request that
     * produces it resolves normally; a request that completes without
     * throwing fails the test. Pair with withoutExceptionHandling().
     * Laravel: expectException
     */
    expectException(error: new (...args: any[]) => Error): this {
      this.expectedExceptions.push(error);

      return this;
    }

    /**
     * Forget any armed expectations
     * Laravel: flushSession-like hygiene between manual phases
     */
    flushExpectations(): this {
      this.expectedExceptions = [];

      return this;
    }

    /**
     * The expectation view the test client consults around every request
     */
    exceptionExpectation(): ExceptionExpectation {
      return {
        isPending: () => this.expectedExceptions.length > 0,
        verifyThrown: (error: unknown): boolean => {
          const expected = this.expectedExceptions[0];

          if (expected && error instanceof expected) {
            this.expectedExceptions.shift();

            return true;
          }

          return false;
        },
        requestCompleted: (): void => {
          if (this.expectedExceptions.length > 0) {
            const expected = this.expectedExceptions.shift();

            throw new Error(`Expected exception [${expected?.name}] was not thrown by the application.`);
          }
        },
      };
    }

    /**
     * Install the expectation hook on the client when the application is
     * (re)built; the base test case calls this after boot
     */
    afterApplicationBoot(): void | Promise<void> {
      void super.afterApplicationBoot();

      this.client.exceptionExpectation = this.exceptionExpectation();
    }

    /**
     * An unmet expectation never travels to the next test
     */
    override async tearDown(): Promise<void> {
      this.expectedExceptions = [];

      await super.tearDown();
    }
  }

  return InteractsWithExceptionHandlingMixin;
}
