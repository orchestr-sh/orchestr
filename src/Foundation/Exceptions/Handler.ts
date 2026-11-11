import type { Application } from '@/Foundation/Application';
import type { Request } from '@/Routing/Request';
import type { Response } from '@/Routing/Response';
import type { ResponseObject } from '@/Routing/Responses/ResponseObject';
import { ValidationException } from '@/Foundation/Http/ValidationException';
import type { ExceptionDetails, ExceptionRenderer } from './Renderer';
import { HtmlRenderer } from './HtmlRenderer';
import { HttpException, httpStatusText } from './HttpException';
import { JsonRenderer } from './JsonRenderer';

/**
 * The container binding shared handlers are resolved through
 * Laravel: Illuminate\Contracts\Debug\ExceptionHandler
 */
export const EXCEPTION_HANDLER_BINDING = 'exceptions';

/**
 * Handler - the single place exceptions are reported and rendered
 * Laravel: Illuminate\Foundation\Exceptions\Handler
 *
 * report() is the seam the logging ticket will wire real channels into;
 * render() normalises the exception and delegates the actual output to a
 * registered ExceptionRenderer (JsonRenderer / HtmlRenderer), so new formats
 * are added with addRenderer() without touching this class.
 */
export class Handler {
  protected app: Application;

  /**
   * Rendering strategies consulted in order; the first that supports the
   * request renders the response, JSON being the fallback default
   */
  protected renderers: ExceptionRenderer[];

  /**
   * Exception classes report() stays silent about
   * Laravel: Handler::$dontReport
   */
  protected dontReportList: Array<new (...args: any[]) => Error> = [];

  constructor(app: Application) {
    this.app = app;
    this.renderers = [new JsonRenderer(), new HtmlRenderer()];
  }

  /**
   * Register an additional rendering strategy, optionally at the front of
   * the priority list. New response formats are added here - never by
   * editing this class (OCP)
   */
  addRenderer(renderer: ExceptionRenderer, prepend: boolean = false): this {
    if (prepend) {
      this.renderers.unshift(renderer);
    } else {
      this.renderers.push(renderer);
    }

    return this;
  }

  /**
   * Register exception classes that should not be reported
   * Laravel: Handler::dontReport()
   */
  dontReport(...exceptions: Array<new (...args: any[]) => Error>): this {
    this.dontReportList.push(...exceptions);
    return this;
  }

  /**
   * Determine whether the given exception should be reported
   * Laravel: Handler::shouldReport()
   */
  shouldReport(error: unknown): boolean {
    return !this.dontReportList.some((reportable) => error instanceof reportable);
  }

  /**
   * Report (log) the exception
   * Laravel: Handler::report()
   *
   * This is the hook the logging ticket will wire channels into; for now it
   * keeps the Kernel's historical console.error behaviour.
   */
  report(error: unknown): void {
    if (!this.shouldReport(error)) {
      return;
    }

    console.error('Error handling request:', error);
  }

  /**
   * Render an exception into a response object
   * Laravel: Handler::render()
   *
   * Returns a ResponseObject; nothing is written to the transport here so
   * callers stay free to post-process the response.
   */
  render(request: Request, error: unknown): ResponseObject {
    const details = this.toDetails(error);

    for (const renderer of this.renderers) {
      if (renderer.supports(request)) {
        return renderer.render(request, details);
      }
    }

    // Neither registered strategy claims the request: JSON is the default
    return new JsonRenderer().render(request, details);
  }

  /**
   * Report the exception and, unless the transport already answered, render
   * it onto the response. The single integration point for Kernel.handle()
   * and Router.dispatch(), keeping the two entry sites free of duplicated
   * catch/render logic.
   */
  async handle(request: Request, error: unknown, response: Response): Promise<void> {
    this.report(error);

    if (response.finished) {
      return;
    }

    await this.render(request, error).sendTo(response);
  }

  /**
   * Normalise any thrown value into the shared render input: status and
   * headers come from HttpException subclasses (422 ValidationException,
   * 403 AccessDeniedHttpException, 401 AuthenticationException, 404
   * NotFoundHttpException/ModelNotFoundException), the error bag only from
   * ValidationException, and everything else is a 500.
   */
  protected toDetails(error: unknown): ExceptionDetails {
    const exception = error instanceof Error ? error : new Error(String(error));
    const http = exception instanceof HttpException ? exception : null;
    const status = http?.getStatus() ?? 500;

    return {
      status,
      message: exception.message || httpStatusText(status),
      headers: http ? http.getHeaders() : {},
      errors: error instanceof ValidationException ? error.errors() : undefined,
      exception,
      debug: this.app.isDebug(),
    };
  }
}

/**
 * Resolve the application's shared exception handler, registering a default
 * one in the container the first time it is needed
 * Laravel: the ExceptionHandler contract bound during bootstrap
 */
export function resolveExceptionHandler(app: Application): Handler {
  if (!app.bound(EXCEPTION_HANDLER_BINDING)) {
    app.singleton(EXCEPTION_HANDLER_BINDING, () => new Handler(app));
  }

  return app.make<Handler>(EXCEPTION_HANDLER_BINDING);
}
