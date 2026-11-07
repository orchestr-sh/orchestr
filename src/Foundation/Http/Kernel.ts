import { IncomingMessage, ServerResponse, createServer, Server } from 'http';
import type { Middleware, MiddlewareArgument } from '@/Routing/Pipeline';
import { Application } from '@/Foundation/Application';
import { Pipeline } from '@/Routing/Pipeline';
import { Request } from '@/Routing/Request';
import { Response } from '@/Routing/Response';
import { Router } from '@/Routing/Router';

/**
 * HTTP Kernel - Handles incoming HTTP requests
 * Laravel's Illuminate\Foundation\Http\Kernel
 */
export class Kernel {
  protected app: Application;
  protected router: Router;
  protected middleware: MiddlewareArgument[] = [];
  protected server?: Server;

  constructor(app: Application) {
    this.app = app;
    this.router = app.make<Router>('router');
  }

  /**
   * Handle an incoming HTTP request
   * Laravel: $kernel->handle($request)
   */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const request = new Request(req);
    const response = new Response(res);

    try {
      // Parse request body
      if (['POST', 'PUT', 'PATCH'].includes(request.method)) {
        await request.parseBody();
      }

      // Run global middleware then dispatch to router
      await this.sendRequestThroughRouter(request, response);
    } catch (error) {
      this.handleException(error, response);
    }
  }

  /**
   * Send the request through the router
   */
  private async sendRequestThroughRouter(request: Request, response: Response): Promise<void> {
    const pipeline = new Pipeline(request, response);

    await pipeline.through(this.router.resolveMiddleware(this.middleware)).run(async () => {
      await this.router.dispatch(request, response);
    });
  }

  /**
   * Handle an exception
   */
  private handleException(error: any, response: Response): void {
    console.error('Error handling request:', error);

    if (!response.finished) {
      response.status(500).json({
        message: error instanceof Error ? error.message : 'Internal Server Error',
        ...(this.app.isDebug() && { stack: error instanceof Error ? error.stack : undefined }),
      });
    }
  }

  /**
   * Add global middleware to the Kernel's stack; the stack runs once around
   * every request instead of middleware being declared per route. Entries are
   * middleware functions or registered alias/group names.
   * Laravel: Kernel::$middleware
   */
  public use(middleware: MiddlewareArgument | MiddlewareArgument[]): this {
    const middlewares = Array.isArray(middleware) ? middleware : [middleware];
    this.middleware.push(...middlewares);
    return this;
  }

  /**
   * The Kernel's global middleware stack, in registration order
   */
  public getMiddleware(): MiddlewareArgument[] {
    return [...this.middleware];
  }

  /**
   * Register a named middleware alias usable by global middleware, route
   * groups and ->middleware('name')
   * Laravel: Router::aliasMiddleware() (synced from the Kernel)
   */
  public middlewareAlias(name: string, middleware: Middleware): this {
    this.router.aliasMiddleware(name, middleware);
    return this;
  }

  /**
   * Register a named group of middleware that expands wherever the group
   * name is referenced
   * Laravel: Router::middlewareGroup() (synced from the Kernel)
   */
  public middlewareGroup(name: string, middleware: MiddlewareArgument[]): this {
    this.router.middlewareGroup(name, middleware);
    return this;
  }

  /**
   * Set the relative ordering used to sort gathered middleware
   * Laravel: Router::middlewarePriority() (synced from the Kernel)
   */
  public middlewarePriority(middleware: MiddlewareArgument[]): this {
    this.router.middlewarePriority(middleware);
    return this;
  }

  /**
   * Add middleware to the start of a middleware group, creating the group
   * when it does not exist yet
   * Laravel: Router::prependMiddlewareToGroup()
   */
  public prependMiddlewareToGroup(name: string, ...middleware: MiddlewareArgument[]): this {
    this.router.prependMiddlewareToGroup(name, ...middleware);
    return this;
  }

  /**
   * Add middleware to the end of a middleware group, creating the group when
   * it does not exist yet
   * Laravel: Router::appendMiddlewareToGroup()
   */
  public appendMiddlewareToGroup(name: string, ...middleware: MiddlewareArgument[]): this {
    this.router.appendMiddlewareToGroup(name, ...middleware);
    return this;
  }

  /**
   * Start the HTTP server
   * Laravel equivalent: php artisan serve
   */
  public listen(port: number = 3000, host: string = 'localhost', callback?: () => void): Server {
    this.server = createServer((req, res) => {
      this.handle(req, res);
    });

    this.server.listen(port, host, () => {
      console.log(`Server running at http://${host}:${port}/`);
      if (callback) callback();
    });

    return this.server;
  }

  /**
   * Stop the HTTP server
   */
  public close(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.server) {
        this.server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Get the application instance
   */
  public getApplication(): Application {
    return this.app;
  }
}
