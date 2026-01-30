import { IncomingMessage, ServerResponse, createServer, Server } from 'http';
import { Application } from '../Application';
import { Router } from '../../Routing/Router';
import { Request } from '../../Routing/Request';
import { Response } from '../../Routing/Response';
import { Middleware } from '../../Routing/Route';

/**
 * HTTP Kernel - Handles incoming HTTP requests
 * Laravel's Illuminate\Foundation\Http\Kernel
 */
export class Kernel {
  protected app: Application;
  protected router: Router;
  protected middleware: Middleware[] = [];
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
    await this.runMiddleware(request, response, async () => {
      await this.router.dispatch(request, response);
    });
  }

  /**
   * Run global middleware
   */
  private async runMiddleware(
    request: Request,
    response: Response,
    finalHandler: () => Promise<void>
  ): Promise<void> {
    const middleware = [...this.middleware];

    const runNext = async (index: number): Promise<void> => {
      if (index >= middleware.length) {
        await finalHandler();
        return;
      }

      const currentMiddleware = middleware[index];
      await currentMiddleware(request, response, () => runNext(index + 1));
    };

    await runNext(0);
  }

  /**
   * Handle an exception
   */
  private handleException(error: any, response: Response): void {
    console.error('Error handling request:', error);

    if (!response.finished) {
      response.status(500).json({
        message: error instanceof Error ? error.message : 'Internal Server Error',
        ...(this.app.isDebug() && { stack: error instanceof Error ? error.stack : undefined })
      });
    }
  }

  /**
   * Add global middleware
   */
  public use(middleware: Middleware): this {
    this.middleware.push(middleware);
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
