import { Route } from './Route';

/**
 * Accepted shapes for named-route parameters: a record keyed by parameter
 * name, a positional array, a single scalar/model, or nothing
 */
export type RouteUrlParameters = Record<string, any> | Array<any> | string | number;

/**
 * UrlGenerator - builds URLs for named routes
 * Illuminate\Routing\UrlGenerator
 *
 * Kept separate from the Router so route dispatch and URL generation do not
 * grow on one god object: it reads the router's named-route registry and
 * fills `:param` placeholders, appending any unused parameters as a query
 * string.
 */
export class UrlGenerator {
  constructor(private getNamedRoutes: () => Map<string, Route>) {}

  /**
   * Generate the URL for a named route
   * Laravel: route('users.show', ['user' => 1])
   */
  route(name: string, parameters: RouteUrlParameters = {}): string {
    const route = this.getNamedRoutes().get(name);

    if (!route) {
      throw new Error(`Route [${name}] not defined.`);
    }

    const values = this.normalizeParameters(route, parameters);
    const used = new Set<string>();

    const host = route.domain ? this.fillDomain(route, values, used) : '';
    const path = this.fillPath(route, values, used);
    const query = this.buildQuery(values, used);

    const base = host ? `http://${host}` : '';
    const suffix = query ? `?${query}` : '';

    return `${base}${path}${suffix}`;
  }

  /**
   * Flatten the accepted parameter shapes into a record keyed by parameter
   * name. Arrays fill the URI parameters positionally; leftovers get numeric
   * keys so they end up in the query string.
   */
  private normalizeParameters(route: Route, parameters: RouteUrlParameters): Record<string, any> {
    if (parameters === undefined || parameters === null) {
      return {};
    }

    if (Array.isArray(parameters)) {
      const names = route.getParameterNames();
      const values: Record<string, any> = {};

      parameters.forEach((value, index) => {
        values[index < names.length ? names[index] : String(index)] = value;
      });

      return values;
    }

    if (typeof parameters === 'object') {
      // A lone model (or any route-key-resolvable object) binds the first parameter
      if (typeof (parameters as any).getRouteKey === 'function') {
        const names = route.getParameterNames();
        return names.length > 0 ? { [names[0]]: parameters } : {};
      }

      return { ...(parameters as Record<string, any>) };
    }

    // Scalars bind the first declared parameter
    const names = route.getParameterNames();
    return names.length > 0 ? { [names[0]]: parameters } : {};
  }

  /**
   * Replace `:param` and `:param?` placeholders in the route URI. Missing
   * optional segments vanish together with their slash; a missing required
   * value is an error. Consumed keys are recorded in `used`.
   */
  private fillPath(route: Route, values: Record<string, any>, used: Set<string>): string {
    let path = '';

    for (const segment of route.uri.split('/').slice(1)) {
      if (segment === '') {
        continue;
      }

      const match = /^:([a-zA-Z_][a-zA-Z0-9_]*)(\?)?$/.exec(segment);

      if (!match) {
        path += `/${segment}`;
        continue;
      }

      const [, name, optional] = match;
      const value = this.takeParameter(values, name, used);

      if (value === undefined) {
        if (optional) {
          continue;
        }

        throw new Error(`Route [${route.name ?? route.uri}] is missing required parameter [${name}].`);
      }

      path += `/${encodeURIComponent(String(value))}`;
    }

    return path === '' ? '/' : path;
  }

  /**
   * Replace `:param` labels in the route's domain constraint
   */
  private fillDomain(route: Route, values: Record<string, any>, used: Set<string>): string {
    return (route.domain ?? '')
      .split('.')
      .map((label) => {
        const match = /^:([a-zA-Z_][a-zA-Z0-9_]*)(\?)?$/.exec(label);

        if (!match) {
          return label;
        }

        const value = this.takeParameter(values, match[1], used);

        if (value === undefined) {
          throw new Error(`Route [${route.name ?? route.uri}] is missing required parameter [${match[1]}].`);
        }

        return encodeURIComponent(String(value));
      })
      .join('.');
  }

  /**
   * Read one parameter, resolving models to their route key, and mark it used
   */
  private takeParameter(values: Record<string, any>, name: string, used: Set<string>): any {
    const resolved = UrlGenerator.resolveValue(values[name]);

    if (resolved !== undefined) {
      used.add(name);
    }

    return resolved;
  }

  /**
   * Route models bind by getRouteKey(); null binds like "absent"
   */
  private static resolveValue(value: any): any {
    if (value === null || value === undefined) {
      return undefined;
    }

    if (typeof value === 'object' && typeof value.getRouteKey === 'function') {
      return value.getRouteKey();
    }

    return value;
  }

  /**
   * Serialize parameters that were not consumed by placeholders into a query
   * string, PHP http_build_query style (arrays and objects nest in brackets)
   */
  private buildQuery(values: Record<string, any>, used: Set<string>): string {
    const pairs: string[] = [];

    const append = (key: string, value: any): void => {
      if (value === null || value === undefined) {
        pairs.push(`${encodeURIComponent(key)}=`);
        return;
      }

      if (Array.isArray(value)) {
        value.forEach((item, index) => append(`${key}[${index}]`, item));
        return;
      }

      const resolved = UrlGenerator.resolveValue(value);

      if (typeof resolved === 'object' && resolved !== null) {
        Object.entries(resolved).forEach(([child, childValue]) => append(`${key}[${child}]`, childValue));
        return;
      }

      pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(resolved))}`);
    };

    for (const [key, value] of Object.entries(values)) {
      if (!used.has(key)) {
        append(key, value);
      }
    }

    return pairs.join('&');
  }
}
