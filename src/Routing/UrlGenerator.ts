import { createHmac, timingSafeEqual } from 'crypto';
import type { Request } from '@/Routing/Request';
import { MissingAppKeyException } from '@/Encryption/MissingAppKeyException';
import { requireAppKey } from '@/Support/AppKey';
import { Route } from './Route';

/**
 * Accepted shapes for named-route parameters: a record keyed by parameter
 * name, a positional array, a single scalar/model, or nothing
 */
export type RouteUrlParameters = Record<string, any> | Array<any> | string | number;

/**
 * Resolves the application key URL signatures are computed with; wired to
 * the container by the Router, injectable for tests
 */
export type UrlSigningKeyResolver = () => string | Buffer | null | undefined;

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
  constructor(
    private getNamedRoutes: () => Map<string, Route>,
    private signingKey: UrlSigningKeyResolver = () => null
  ) {}

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
   * Generate a signed URL for a named route
   *
   * The signature covers the exact URL (plus an optional `expires`
   * parameter), so any modification - a swapped query value, a second
   * `signature=` pair - invalidates it. Provide an expiry to limit how long
   * the link works.
   *
   * Laravel: URL::signedRoute('unsubscribe', ['user' => 1], now()->addMinutes(30))
   */
  signedRoute(name: string, parameters: RouteUrlParameters = {}, expiration?: number | Date): string {
    let url = this.route(name, parameters);

    if (expiration !== undefined && expiration !== null) {
      url = this.appendToUrl(url, `expires=${this.expirationSeconds(expiration)}`);
    }

    return this.appendToUrl(url, `signature=${encodeURIComponent(this.sign(url))}`);
  }

  /**
   * Generate a temporary signed URL for a named route
   *
   * Laravel: URL::temporarySignedRoute('newsletter', now()->addMinutes(30))
   */
  temporarySignedRoute(name: string, expiration: number | Date, parameters: RouteUrlParameters = {}): string {
    return this.signedRoute(name, parameters, expiration);
  }

  /**
   * Determine whether the request carries a valid signature
   *
   * A request wins when one of its candidate URLs - the raw request target
   * and, with a Host header, its http/https absolute forms - matches the
   * signature it presents, ignoring the signature parameter itself, and
   * when a present `expires` has not passed. Candidates mirror what
   * signedRoute() may have produced for domain or relative routes.
   *
   * Laravel: Request::hasValidSignature() / UrlGenerator::hasValidSignature()
   */
  hasValidSignature(request: Request): boolean {
    return this.hasCorrectSignature(request) && this.signatureHasNotExpired(request);
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

  /**
   * HMAC-SHA256 the URL with the application key, base64url encoded
   * Laravel: UrlGenerator::signatureHasher()->hashRequired()
   */
  private sign(url: string): string {
    const key = requireAppKey(this.signingKey());

    return createHmac('sha256', key).update(url).digest('base64url');
  }

  /**
   * Compare a computed signature with the one presented, in constant time
   * Laravel: hash_equals()
   */
  private signMatches(url: string, signature: string): boolean {
    let computed: string;

    try {
      computed = this.sign(url);
    } catch (error) {
      // A missing app key is a server misconfiguration, not a bad link:
      // surface it instead of reporting someone else's URL as invalid
      if (error instanceof MissingAppKeyException) {
        throw error;
      }

      return false;
    }

    const expected = Buffer.from(computed);
    const presented = Buffer.from(signature);

    return expected.length === presented.length && timingSafeEqual(expected, presented);
  }

  /**
   * The URLs the presented signature could have been computed over
   */
  private hasCorrectSignature(request: Request): boolean {
    const signature = request.query.signature;

    if (typeof signature !== 'string' || signature === '') {
      return false;
    }

    const unsigned = this.removeSignature(request.url ?? '/');
    const candidates = [unsigned];

    const host = request.header('host');

    if (host && unsigned.startsWith('/')) {
      // A route registered with a domain signs the absolute URL; the
      // request only carries the path, so reconstruct the candidates
      candidates.push(`http://${host}${unsigned}`, `https://${host}${unsigned}`);
    }

    return candidates.some((candidate) => this.signMatches(candidate, signature));
  }

  /**
   * A signature with an `expires` parameter is only valid until then
   * Laravel: UrlGenerator::signatureHasNotExpired()
   */
  private signatureHasNotExpired(request: Request): boolean {
    const expires = request.query.expires;

    if (expires === undefined || expires === '') {
      return true;
    }

    const seconds = Number(expires);

    if (!Number.isFinite(seconds)) {
      return false;
    }

    return Math.floor(Date.now() / 1000) <= seconds;
  }

  /**
   * Append a query pair, choosing the separator by whether the URL already
   * carries a query string
   */
  private appendToUrl(url: string, pair: string): string {
    return `${url}${url.includes('?') ? '&' : '?'}${pair}`;
  }

  /**
   * Strip only the `signature` parameter from a URL, leaving the rest of
   * the query string byte-for-byte as the client sent it
   * Laravel: UrlGenerator::removeSignatureFromUrl()
   */
  private removeSignature(url: string): string {
    const separatorIndex = url.indexOf('?');

    if (separatorIndex === -1) {
      return url;
    }

    const path = url.slice(0, separatorIndex);
    const pairs = url
      .slice(separatorIndex + 1)
      .split('&')
      .filter((pair) => pair !== '' && pair.split('=')[0] !== 'signature');

    return pairs.length > 0 ? `${path}?${pairs.join('&')}` : path;
  }

  /**
   * Render the expiration as unix seconds; numbers are already seconds
   * (unix timestamps), matching the `expires=` query encoding
   */
  private expirationSeconds(expiration: number | Date): number {
    if (expiration instanceof Date) {
      return Math.floor(expiration.getTime() / 1000);
    }

    if (typeof expiration === 'number' && Number.isFinite(expiration)) {
      return Math.floor(expiration);
    }

    throw new TypeError('Signed URL expiration must be a unix timestamp in seconds or a Date.');
  }
}
