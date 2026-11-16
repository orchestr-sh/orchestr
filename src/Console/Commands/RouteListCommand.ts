/**
 * RouteListCommand
 *
 * Show the application's registered routes in an Artisan-style table:
 * method, URI, name, action, and middleware. Supports `--json` for tooling
 * and `--path=` to filter URIs. Mirrors Laravel's `php artisan route:list`.
 *
 * The command is a formatter only: it boots the application (so route files
 * or the cached route collection register themselves), asks the Router for
 * its collection, and renders. No routing logic lives here.
 */

import type { Route } from '@/Routing/Route';
import type { Router } from '@/Routing/Router';
import { Command, CommandOptions } from '@/Console/Command';
import { Application } from '@/Foundation/Application';

interface RouteListRow {
  method: string;
  uri: string;
  name: string;
  action: string;
  middleware: string;
}

export class RouteListCommand extends Command {
  signature = 'route:list {--json : Output the route list as JSON} {--path= : Filter the routes by the given URI path}';
  description = 'List all registered routes';

  constructor(protected app: Application) {
    super();
  }

  async handle(_args: string[] = [], options: CommandOptions = {}): Promise<void> {
    // Registering routes happens while providers boot (or from the cached
    // collection), exactly like Artisan booting the framework first.
    await this.app.boot();

    if (!this.app.bound('router')) {
      this.error('The router is not registered; there are no routes to list.');
      return;
    }

    const router = this.app.make<Router>('router');
    let rows = router.getRoutes().map(toRow);

    const path = typeof options.path === 'string' ? options.path : undefined;

    if (path !== undefined) {
      rows = rows.filter((row) => row.uri.includes(path));
    }

    if (options.json === true || options.json === 'true') {
      this.line(JSON.stringify(rows, null, 2));
      return;
    }

    this.table(['Method', 'URI', 'Name', 'Action', 'Middleware'], rows.map(toTableCells));
    this.newLine();
    this.comment(`Showing [${rows.length}] route${rows.length === 1 ? '' : 's'}`);
  }
}

function toRow(route: Route): RouteListRow {
  return {
    method: route.methods.join('|'),
    uri: route.uri,
    name: route.name ?? '',
    action: describeAction(route),
    middleware: route.middlewareList.map(describeMiddleware).join(', '),
  };
}

function toTableCells(row: RouteListRow): string[] {
  return [row.method, row.uri, row.name, row.action, row.middleware];
}

/**
 * Laravel prints `Controller@method` for string actions and `Closure` (with
 * file:line) for functions; class tuples print as `ClassName@method`.
 */
function describeAction(route: Route): string {
  const { action } = route;

  if (typeof action === 'string') {
    return action;
  }

  if (Array.isArray(action)) {
    const [ControllerClass, method] = action as [(new (...args: any[]) => any) | string, string];
    const name = typeof ControllerClass === 'string' ? ControllerClass : ControllerClass.name;

    return `${name}@${method}`;
  }

  return action.name !== '' && action.name !== 'anonymous' ? action.name : 'Closure';
}

function describeMiddleware(middleware: unknown): string {
  if (typeof middleware === 'string') {
    return middleware;
  }

  return typeof middleware === 'function' && middleware.name !== '' ? middleware.name : 'Closure';
}
