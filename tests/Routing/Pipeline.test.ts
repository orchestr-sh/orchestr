import { IncomingMessage, ServerResponse } from 'http';
import { Socket } from 'net';
import { describe, it, expect } from 'vitest';
import type { Middleware, NextFunction, TerminableMiddleware } from '@/Routing/Pipeline';
import { Pipeline, isTerminable } from '@/Routing/Pipeline';
import { Request } from '@/Routing/Request';
import { Response } from '@/Routing/Response';

describe('Pipeline', () => {
  // -------------------------------------------------------------------------
  // Harness - the pipeline only needs a Request/Response pair to carry
  // -------------------------------------------------------------------------

  function createHarness(): { req: Request; res: Response; raw: ServerResponse; chunks: string[] } {
    const req = new IncomingMessage(new Socket());
    req.method = 'GET';
    req.url = '/';
    req.headers = {};

    const request = new Request(req);
    const raw = new ServerResponse(request.raw);
    const chunks: string[] = [];

    raw.end = ((data?: any) => {
      if (data !== undefined && data !== null) {
        chunks.push(String(data));
      }
    }) as any;
    raw.setHeader = (() => {}) as any;

    return { req: request, res: new Response(raw), raw, chunks };
  }

  it('runs middleware in order around the destination', async () => {
    const { req, res } = createHarness();
    const order: string[] = [];

    const outer: Middleware = async (_req, _res, next: NextFunction) => {
      order.push('outer-in');
      await next();
      order.push('outer-out');
    };
    const inner: Middleware = async (_req, _res, next: NextFunction) => {
      order.push('inner-in');
      await next();
      order.push('inner-out');
    };

    await new Pipeline(req, res).through([outer, inner]).run(async () => {
      order.push('destination');
    });

    expect(order).toEqual(['outer-in', 'inner-in', 'destination', 'inner-out', 'outer-out']);
  });

  it('runs the destination directly with an empty stack', async () => {
    const { req, res } = createHarness();
    let ran = false;

    await new Pipeline(req, res).through([]).run(async () => {
      ran = true;
    });

    expect(ran).toBe(true);
  });

  it('awaits the downstream chain even when middleware forgets to await next()', async () => {
    const { req, res } = createHarness();
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const fireAndForget: Middleware = (_req, _res, next) => {
      next();
      order.push('outer-continued');
    };
    const slow: Middleware = async (_req, _res, next) => {
      await gate;
      order.push('inner-continued');
      await next();
    };

    const run = new Pipeline(req, res).through([fireAndForget, slow]).run(async () => {
      order.push('destination');
    });

    release();
    await run;

    // The pipeline unwinds only after the whole downstream chain settles
    expect(order).toEqual(['outer-continued', 'inner-continued', 'destination']);
  });

  it('short-circuits when middleware returns a sent response', async () => {
    const { req, res, chunks, raw } = createHarness();
    let downstreamRan = false;
    let destinationRan = false;

    const blocker: Middleware = (_req, response, _next) => {
      response.status(401).send('Blocked');
      return response;
    };
    const downstream: Middleware = (_req, _res, next) => {
      downstreamRan = true;
      return next();
    };

    await new Pipeline(req, res).through([blocker, downstream]).run(async () => {
      destinationRan = true;
    });

    expect(raw.statusCode).toBe(401);
    expect(chunks).toEqual(['Blocked']);
    expect(downstreamRan).toBe(false);
    expect(destinationRan).toBe(false);
  });

  it('sends an unsent response returned by middleware', async () => {
    const { req, res, raw } = createHarness();
    let destinationRan = false;

    const blocker: Middleware = (_req, response) => response.status(403);

    await new Pipeline(req, res).through([blocker]).run(async () => {
      destinationRan = true;
    });

    expect(raw.statusCode).toBe(403);
    expect(res.finished).toBe(true);
    expect(destinationRan).toBe(false);
  });

  it('stops the chain when middleware never calls next()', async () => {
    const { req, res } = createHarness();
    let destinationRan = false;

    const sink: Middleware = (_req, response) => {
      response.status(204).send(undefined);
    };

    await new Pipeline(req, res).through([sink]).run(async () => {
      destinationRan = true;
    });

    expect(res.finished).toBe(true);
    expect(destinationRan).toBe(false);
  });

  it('runs the rest of the chain only once when next() is called twice', async () => {
    const { req, res } = createHarness();
    let destinations = 0;

    const duplicator: Middleware = (_req, _res, next) => {
      next();
      next();
    };

    await new Pipeline(req, res).through([duplicator]).run(async () => {
      destinations += 1;
    });

    expect(destinations).toBe(1);
  });

  it('terminates middleware that implement terminate after the response is sent', async () => {
    const { req, res } = createHarness();
    const events: string[] = [];
    let sawFinished: boolean | null = null;

    const first: TerminableMiddleware = Object.assign(
      async (_req: Request, _res: Response, next: NextFunction) => {
        events.push('first');
        await next();
      },
      {
        terminate: (_req: Request, response: Response) => {
          events.push('first-terminate');
          sawFinished = response.finished;
        },
      }
    );
    const plain: Middleware = async (_req, _res, next) => {
      events.push('plain');
      await next();
    };
    const second: TerminableMiddleware = Object.assign(
      async (_req: Request, _res: Response, next: NextFunction) => {
        events.push('second');
        await next();
      },
      { terminate: () => void events.push('second-terminate') }
    );

    await new Pipeline(req, res).through([first, plain, second]).run(async () => {
      res.send('done');
    });

    expect(sawFinished).toBe(true);
    expect(events).toEqual(['first', 'plain', 'second', 'first-terminate', 'second-terminate']);
  });

  it('terminates every pipeline member even when the chain short-circuits early', async () => {
    const { req, res } = createHarness();
    const terminated: string[] = [];
    let destinationRan = false;

    const blocker: TerminableMiddleware = Object.assign(
      (_req: Request, response: Response) => response.status(503).send('Down'),
      { terminate: () => void terminated.push('blocker') }
    );
    const neverReached: TerminableMiddleware = Object.assign(
      (_req: Request, _res: Response, next: NextFunction) => next(),
      { terminate: () => void terminated.push('neverReached') }
    );

    await new Pipeline(req, res).through([blocker, neverReached]).run(async () => {
      destinationRan = true;
    });

    expect(destinationRan).toBe(false);
    expect(terminated).toEqual(['blocker', 'neverReached']);
  });

  it('terminates even when the destination throws, then rethrows', async () => {
    const { req, res } = createHarness();
    let terminated = false;

    const watcher: TerminableMiddleware = Object.assign(
      async (_req: Request, _res: Response, next: NextFunction) => {
        await next();
      },
      { terminate: () => void (terminated = true) }
    );

    await expect(
      new Pipeline(req, res).through([watcher]).run(async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    expect(terminated).toBe(true);
  });

  it('recognises terminable middleware', () => {
    const plain: Middleware = (_req, _res, next) => next();
    const base: Middleware = (_req, _res, next) => next();
    const terminable: TerminableMiddleware = Object.assign(base, { terminate: () => {} });

    expect(isTerminable(plain)).toBe(false);
    expect(isTerminable(terminable)).toBe(true);
  });
});
