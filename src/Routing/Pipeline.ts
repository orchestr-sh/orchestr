import type { Request } from './Request';
import { Response } from './Response';

/**
 * Continuation into the rest of the pipeline: the next middleware, or the
 * destination once the last pipe has been reached
 * Laravel: the `$next` closure received by middleware in a pipeline
 */
export type NextFunction = () => Promise<void>;

/**
 * HTTP middleware
 * Laravel: middleware classes carried by Illuminate\Pipeline\Pipeline
 *
 * Middleware continues by calling `next()`; returning a Response instead
 * short-circuits the pipeline so the destination and downstream middleware
 * never run. A terminable middleware attaches a `terminate` hook, which the
 * pipeline runs after the response has been sent.
 */
export type Middleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => void | Response | Promise<void | Response>;

/**
 * Middleware exposing Laravel's terminate-after-response contract
 * Illuminate\Contracts\Routing\TerminableMiddleware
 */
export type TerminableMiddleware = Middleware & {
  terminate: (req: Request, res: Response) => void | Promise<void>;
};

/**
 * Determine whether a middleware implements the terminable contract
 */
export function isTerminable(middleware: Middleware): middleware is TerminableMiddleware {
  return typeof (middleware as TerminableMiddleware).terminate === 'function';
}

/**
 * A middleware reference: the function itself, or the name of a registered
 * alias or group
 * Laravel: the class names and group names accepted by Route::middleware()
 */
export type MiddlewareArgument = Middleware | string;

/**
 * The final handler the pipeline hands the request to once every pipe has
 * passed it along
 * Laravel: the closure passed to Pipeline::then()
 */
export type Destination = (req: Request, res: Response) => void | Promise<void>;

/**
 * Pipeline - the single HTTP middleware loop shared by the Kernel's global
 * stack and the Router's route stack
 * Illuminate\Pipeline\Pipeline
 */
export class Pipeline {
  private readonly req: Request;
  private readonly res: Response;
  private pipes: Middleware[] = [];

  constructor(req: Request, res: Response) {
    this.req = req;
    this.res = res;
  }

  /**
   * Set the middleware the request should pass through, in execution order
   * Laravel: Pipeline::through()
   */
  through(middleware: Middleware[]): this {
    this.pipes = [...middleware];
    return this;
  }

  /**
   * Run the pipeline to its destination, then fire the terminable hooks
   * Laravel: Pipeline::then() followed by the Kernel's middleware termination
   */
  async run(destination: Destination): Promise<void> {
    try {
      await this.carried(destination, 0);
    } finally {
      await this.terminate();
    }
  }

  /**
   * Carry the request through one pipe, wiring its continuation to the rest
   * of the pipeline
   * Laravel: Pipeline::carry()/carryThrough()
   */
  private async carried(destination: Destination, index: number): Promise<void> {
    if (index >= this.pipes.length) {
      await destination(this.req, this.res);
      return;
    }

    const pipe = this.pipes[index];

    // The downstream promise is memoised: calling next() more than once must
    // not run the rest of the pipeline twice, and a middleware that forgets
    // to await next() still has its continuation awaited before the pipeline
    // unwinds.
    let downstream: Promise<void> | null = null;

    const next: NextFunction = () => {
      downstream ??= this.carried(destination, index + 1);
      return downstream;
    };

    const outcome = await pipe(this.req, this.res, next);

    if (outcome instanceof Response) {
      // The middleware returned a response: that is the pipeline's verdict.
      // Any pending downstream chain is discarded, and an unsent response is
      // flushed so the caller always ends with a sent response.
      if (!outcome.finished) {
        outcome.send(undefined);
      }
    } else if (downstream) {
      await downstream;
    }
  }

  /**
   * Run terminate() on every pipeline member that implements it, in
   * registration order, after the response has been sent
   * Laravel: Kernel::terminateMiddleware()
   */
  private async terminate(): Promise<void> {
    for (const pipe of this.pipes) {
      if (isTerminable(pipe)) {
        await pipe.terminate(this.req, this.res);
      }
    }
  }
}
