/**
 * RouteCache
 *
 * Serializes the Router's route collection into `bootstrap/cache/routes.json`
 * and re-registers it into a Router from that snapshot, so a booted
 * application can hydrate every route without importing (and evaluating) the
 * route files. Mirrors Laravel's `route:cache` / `route:clear` pair plus the
 * `CachedRouteRegistrar` that boots the cache in production.
 *
 * What survives the round-trip is what Laravel can represent too: routes whose
 * action is a `Controller@method` string and whose middleware are alias/group
 * names. Closure actions, `[ControllerClass, 'method']` tuples, and function
 * middleware reference live code, so caching refuses them loudly instead of
 * silently dropping behaviour.
 *
 * SRP: this class owns only the snapshot format (the route collection's
 * cache writer); the commands stay thin argument/output wrappers.
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import type { Application } from '@/Foundation/Application';
import type { HttpMethod, Route } from './Route';
import type { Router } from './Router';

/** One route rendered as JSON. */
export interface CachedRoute {
  methods: string[];
  uri: string;
  /** `Controller@method` - the only action form JSON can carry. */
  action: string;
  name: string | null;
  middleware: string[];
  excluded: string[];
  wheres: Record<string, string>;
  domain: string | null;
  scoped: boolean;
  fallback: boolean;
}

/** The snapshot document written to the cache path. */
export interface CachedRouteCollection {
  version: number;
  routes: CachedRoute[];
}

/** Bump when the snapshot shape changes so stale caches are rejected. */
export const ROUTE_CACHE_VERSION = 1;

export class RouteCache {
  constructor(private app: Application) {}

  /**
   * The file the snapshot lives in.
   */
  path(): string {
    return this.app.getCachedRoutesPath();
  }

  /**
   * Determine whether a cached route collection exists.
   */
  isCached(): boolean {
    return existsSync(this.path());
  }

  /**
   * Render the router's collection as cacheable plain data, refusing routes
   * JSON cannot represent (closure actions, class tuples, function
   * middleware) the way Laravel refuses Closure routes.
   */
  serialize(router: Router): CachedRoute[] {
    return router.getRoutes().map((route) => this.toCached(route));
  }

  /**
   * Write the snapshot for the current collection and return the path.
   */
  cache(router: Router): string {
    const routes = this.serialize(router);
    const document: CachedRouteCollection = { version: ROUTE_CACHE_VERSION, routes };

    let json: string;

    try {
      json = JSON.stringify(document, null, 2);
    } catch (error) {
      throw new Error('Unable to cache routes: the collection is not serializable.', { cause: error });
    }

    const path = this.path();

    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, json + '\n', 'utf-8');

    return path;
  }

  /**
   * Read the snapshot's route list. Throws when the file is missing,
   * malformed, or written by a different cache format version.
   */
  load(): CachedRoute[] {
    const path = this.path();

    if (!existsSync(path)) {
      throw new Error(`The route cache [${path}] does not exist.`);
    }

    let document: CachedRouteCollection;

    try {
      document = JSON.parse(readFileSync(path, 'utf-8'));
    } catch (error) {
      throw new Error(`The route cache [${path}] is not valid JSON. Run route:clear and route:cache again.`, {
        cause: error,
      });
    }

    if (document === null || typeof document !== 'object' || !Array.isArray(document.routes)) {
      throw new Error(`The route cache [${path}] is malformed. Run route:clear and route:cache again.`);
    }

    if (document.version !== ROUTE_CACHE_VERSION) {
      throw new Error(
        `The route cache [${path}] was written by another cache format. Run route:clear and route:cache again.`
      );
    }

    return document.routes;
  }

  /**
   * Re-register the cached routes into the router, restoring methods, URI,
   * action, name, middleware, constraints, domain, and fallback status.
   *
   * @returns the number of routes registered
   */
  restore(router: Router): number {
    const routes = this.load();

    for (const cached of routes) {
      const route = this.register(router, cached);

      if (cached.middleware.length > 0) {
        route.middleware(cached.middleware);
      }

      if (cached.excluded.length > 0) {
        route.withoutMiddleware(cached.excluded);
      }

      if (Object.keys(cached.wheres).length > 0) {
        route.where(cached.wheres);
      }

      if (cached.domain !== null) {
        route.domain = cached.domain;
      }

      if (cached.scoped) {
        route.scopeBindings();
      }

      if (cached.name !== null) {
        router.name(cached.name, route);
      }
    }

    return routes.length;
  }

  /**
   * Remove the snapshot. Returns true when a file was deleted.
   */
  clear(): boolean {
    const path = this.path();

    if (!existsSync(path)) {
      return false;
    }

    unlinkSync(path);

    return true;
  }

  // ------------------------------------------------------------- internals

  private register(router: Router, cached: CachedRoute): Route {
    if (cached.fallback) {
      return router.fallback(cached.action);
    }

    return router.match(cached.methods as HttpMethod[], cached.uri, cached.action);
  }

  private toCached(route: Route): CachedRoute {
    return {
      methods: [...route.methods],
      uri: route.uri,
      action: this.serializeAction(route),
      name: route.name ?? null,
      middleware: this.serializeMiddleware(route, route.middlewareList),
      excluded: this.serializeMiddleware(route, route.excludedMiddleware),
      wheres: { ...route.wheres },
      domain: route.domain ?? null,
      scoped: route.scopedBindings,
      fallback: route.isFallback,
    };
  }

  private serializeAction(route: Route): string {
    const { action } = route;

    if (typeof action === 'string') {
      if (!action.includes('@')) {
        throw new Error(
          `Unable to cache route [${route.methods.join('|')} ${route.uri}]: the action string ` +
            `[${action}] is not in the 'Controller@method' form the cache restores.`
        );
      }

      return action;
    }

    if (Array.isArray(action)) {
      throw new Error(
        `Unable to cache route [${route.methods.join('|')} ${route.uri}]: it uses a controller class ` +
          `reference. Register the action as a 'Controller@method' string the container resolves.`
      );
    }

    throw new Error(`Unable to cache route [${route.methods.join('|')} ${route.uri}]. Uses Closure.`);
  }

  private serializeMiddleware(route: Route, middleware: unknown[]): string[] {
    return middleware.map((entry) => {
      if (typeof entry !== 'string') {
        throw new Error(
          `Unable to cache route [${route.methods.join('|')} ${route.uri}]: it carries inline function ` +
            `middleware, which JSON cannot represent. Register it as a named alias or group.`
        );
      }

      return entry;
    });
  }
}
