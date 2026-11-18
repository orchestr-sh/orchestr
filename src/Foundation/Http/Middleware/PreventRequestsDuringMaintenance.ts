/**
 * PreventRequestsDuringMaintenance middleware
 *
 * While `Application.isDownForMaintenance()`, every request answers 503
 * with a `Retry-After` header - JSON `{ message }` for API clients, an
 * HTML page otherwise (the view recorded by `down --render` when the
 * application can render one, the plain message when it cannot).
 *
 * Two bypasses are honoured, and only those:
 * - requests whose path matches an entry of the `maintenance.except`
 *   allow-list (wildcards via Str.is), and
 * - when `down --secret` recorded a token, requests carrying it as the
   `secret` query parameter (which then receives the `_maintenance_token`
   cookie) or as that cookie.
 *
 * The state is read through the Application (DRY); the middleware owns no
 * maintenance storage of its own.
 *
 * Laravel: Illuminate\Foundation\Http\Middleware\PreventRequestsDuringMaintenance
 *
 * @example
 * ```typescript
 * // config/maintenance.ts
 * export default { except: ['/up', '/webhooks/*'] };
 *
 * kernel.prepend(PreventRequestsDuringMaintenance);
 * ```
 */

import type { Application } from '@/Foundation/Application';
import type { MaintenanceModeData } from '@/Foundation/MaintenanceMode';
import type { Middleware } from '@/Routing/Pipeline';
import type { Request } from '@/Routing/Request';
import type { ViewFactory } from '@/View/ViewFactory';
import { JsonResponse, ResponseObject } from '@/Routing/Responses';
import { getGlobalApp } from '@/Support/helpers';
import { Str } from '@/Support/Str';

/**
 * The cookie a secret-guarded bypass leaves behind so subsequent requests
 * keep flowing through
 * Laravel: Illuminate\Foundation\Http\Middleware\PreventRequestsDuringMaintenance::$_maintenanceCookieName
 */
export const MAINTENANCE_COOKIE = '_maintenance_token';

/**
 * The `maintenance` middleware configuration
 */
export interface MaintenanceMiddlewareConfig {
  /**
   * Paths (leading slashes optional, `*` wildcards allowed) that answer
   * normally even while the application is down - health checks, webhooks
   */
  except: string[];
}

/**
 * The message and status the ticket's 503 answers fall back to when the
 * maintenance data recorded none
 */
const DEFAULT_MESSAGE = 'Service Unavailable';
const DEFAULT_RETRY_SECONDS = 60;

/**
 * Normalise a raw `maintenance` config section: `except` accepts a single
 * path or a list
 */
export function resolveMaintenanceConfig(section: unknown): MaintenanceMiddlewareConfig {
  const provided = section && typeof section === 'object' ? (section as Partial<MaintenanceMiddlewareConfig>) : {};
  const value = provided.except;

  return { except: value === undefined ? [] : (Array.isArray(value) ? value : [value]).map((p) => String(p)) };
}

/**
 * Read the application's `maintenance` configuration section
 * Laravel: config('maintenance')
 */
export function resolveMaintenanceOptions(app: Application | null): MaintenanceMiddlewareConfig {
  if (!app || !app.bound('config')) {
    return { except: [] };
  }

  try {
    const config = app.make<{ get: <T = any>(key: string, defaultValue?: T) => T }>('config');

    return resolveMaintenanceConfig(config.get<unknown>('maintenance'));
  } catch {
    return { except: [] };
  }
}

/**
 * Build the maintenance middleware over explicit seams - the path tests
 * and embedders use to pin the application and the configuration instead
 * of the container's global app.
 */
export function makePreventRequestsDuringMaintenance(
  deps: {
    /**
     * Where the maintenance state is read from; defaults to the global app
     */
    app?: () => Application | null;
    /**
     * The middleware configuration; defaults to `config('maintenance')`
     */
    options?: (app: Application | null) => MaintenanceMiddlewareConfig;
  } = {}
): Middleware {
  const configOf = (app: Application | null) => (deps.options ? deps.options(app) : resolveMaintenanceOptions(app));

  const middleware: Middleware = async (req, res, next) => {
    const app = deps.app ? deps.app() : getGlobalApp();

    if (!app || !app.isDownForMaintenance()) {
      return next();
    }

    const data = app.maintenanceMode().data();

    // Allow-listed paths answer normally even while down
    const path = withoutLeadingSlash(req.getPath());

    if (configOf(app).except.some((pattern) => Str.is(withoutLeadingSlash(pattern), path))) {
      return next();
    }

    // A recorded secret opens the gate for requests carrying it - the
    // query parameter first (it hands the visitor the cookie for the
    // requests after), then the cookie itself
    const { secret } = data;

    if (typeof secret === 'string' && secret !== '') {
      if (req.cookie(MAINTENANCE_COOKIE) === secret) {
        return next();
      }

      if (req.get('secret') === secret) {
        res.cookie(MAINTENANCE_COOKIE, secret, { path: '/', httpOnly: true, maxAge: 60 * 60 * 24 * 365 * 5 });

        return next();
      }
    }

    return await maintenanceResponse(req, app, data);
  };

  return middleware;
}

/**
 * The 503 answer: JSON for clients that expect it, the `--render` view for
 * HTML requests that have one, the recorded (or default) message otherwise
 * Laravel: PreventRequestsDuringMaintenance::buildResponse()
 */
async function maintenanceResponse(req: Request, app: Application, data: MaintenanceModeData) {
  const retry = retryAfter(data);
  const headers: Record<string, string> = { 'Retry-After': String(retry) };
  const message = typeof data.message === 'string' && data.message !== '' ? data.message : DEFAULT_MESSAGE;

  if (req.expectsJson()) {
    return new JsonResponse({ message }, 503, headers);
  }

  const view = typeof data.render === 'string' && data.render !== '' ? data.render : undefined;

  if (view) {
    const html = await renderMaintenanceView(app, view, message);

    if (html !== undefined) {
      return new ResponseObject(html, 503, { 'Content-Type': 'text/html', ...headers });
    }
  }

  return new ResponseObject(message, 503, { 'Content-Type': 'text/html', ...headers });
}

/**
 * Seconds the Retry-After header asks for; a missing or malformed value
 * falls back to the framework default
 * Laravel: MaintenanceModeData::$retry
 */
function retryAfter(data: MaintenanceModeData): number {
  const retry = Number(data.retry);

  return Number.isFinite(retry) && retry >= 0 ? Math.floor(retry) : DEFAULT_RETRY_SECONDS;
}

/**
 * Render the configured maintenance view through the container's view
 * factory; undefined when no view system is bound or the view is missing,
 * which drops the response back to the plain message
 * Laravel: $this->renderView($view, $message)
 */
async function renderMaintenanceView(app: Application, view: string, message: string): Promise<string | undefined> {
  let factory: ViewFactory;

  try {
    factory = app.make<ViewFactory>('view');
  } catch {
    return undefined;
  }

  try {
    if (!factory.exists(view)) {
      return undefined;
    }

    return await factory.make(view, { message }).render();
  } catch {
    return undefined;
  }
}

/**
 * Compare paths without their leading slash, the way Laravel's
 * $request->path() hands them to the middleware's $except patterns
 */
function withoutLeadingSlash(path: string): string {
  return path.replace(/^\/+/, '');
}

/**
 * The container-driven maintenance middleware, ready for the Kernel's
 * global stack
 * Laravel: Kernel::$middleware's PreventRequestsDuringMaintenance entry
 */
export const PreventRequestsDuringMaintenance: Middleware = (req, res, next, ...args) =>
  makePreventRequestsDuringMaintenance()(req, res, next, ...args);
