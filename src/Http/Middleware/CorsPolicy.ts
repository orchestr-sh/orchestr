/**
 * CorsPolicy - the single place CORS answers are calculated
 * Illuminate/Http/Middleware/HandleCors' CorsService (Fruitcake)
 *
 * The policy turns the `cors.*` configuration into response headers: which
 * origins may cross the wire, which methods and headers a preflight may use,
 * which response headers a browser script may read, and whether cookies or
 * authorization headers ride along. Every rule the CORS specification sets
 * lives here (SRP); HandleCors only asks questions and applies the answers.
 *
 * Two spec rules drive the whole class:
 * - `Access-Control-Allow-Origin: *` may only be sent for requests that do
 *   not carry credentials.
 * - Once credentials are supported, the concrete origin is echoed back
 *   instead - wildcard and credentials never mix.
 *
 * @example
 * ```typescript
 * const policy = new CorsPolicy({ allowed_origins: ['https://app.test'], supports_credentials: true, ... });
 *
 * if (policy.isPreflightRequest(req)) {
 *   return new ResponseObject(null, 204, policy.preflightHeaders(req));
 * }
 * ```
 */

import type { Request } from '@/Routing/Request';

/**
 * The `cors` configuration section
 * Laravel: config/cors.php
 */
export interface CorsConfig {
  /**
   * Origins allowed to cross domains. Entries are exact origins
   * (`https://app.test`), the `*` wildcard, or patterns containing `*`
   * (`https://*.app.test`).
   */
  allowed_origins: string[];

  /**
   * Methods a preflight may request; `*` allows any method
   */
  allowed_methods: string[];

  /**
   * Headers a preflight may request; `*` echoes the requested set back
   */
  allowed_headers: string[];

  /**
   * Response headers browser scripts may read
   */
  exposed_headers: string[];

  /**
   * Seconds a browser may cache the preflight answer (0 disables the header)
   */
  max_age: number;

  /**
   * Whether cookies / authorization headers travel cross-site; forces the
   * concrete origin to be echoed instead of `*`
   */
  supports_credentials: boolean;
}

/**
 * The Laravel framework defaults for config/cors.php, minus `paths` (this
 * middleware runs from the global stack over every request)
 */
export const DEFAULT_CORS_CONFIG: CorsConfig = {
  allowed_origins: ['*'],
  allowed_methods: ['*'],
  allowed_headers: ['*'],
  exposed_headers: [],
  max_age: 0,
  supports_credentials: false,
};

/**
 * The method list answered to a credentialed preflight when the application
 * allowed `*`: browsers reject `*` alongside credentials, so the CORS-
 * relevant verbs are spelled out instead
 */
const WILDCARD_METHODS = ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'];

/**
 * Normalize a raw `cors` config section onto the framework defaults; array
 * entries are coerced to arrays and casing differences on methods/headers
 * are preserved for the response but matched case-insensitively
 */
export function resolveCorsConfig(section: unknown): CorsConfig {
  const provided = section && typeof section === 'object' ? (section as Partial<CorsConfig>) : {};

  const config: CorsConfig = {
    allowed_origins: toArray(provided.allowed_origins, DEFAULT_CORS_CONFIG.allowed_origins),
    allowed_methods: toArray(provided.allowed_methods, DEFAULT_CORS_CONFIG.allowed_methods),
    allowed_headers: toArray(provided.allowed_headers, DEFAULT_CORS_CONFIG.allowed_headers),
    exposed_headers: toArray(provided.exposed_headers, DEFAULT_CORS_CONFIG.exposed_headers),
    max_age: Number.isFinite(provided.max_age) ? Number(provided.max_age) : DEFAULT_CORS_CONFIG.max_age,
    supports_credentials: Boolean(provided.supports_credentials),
  };

  return config;
}

/**
 * CorsPolicy - answers the middleware's spec questions for one configuration
 */
export class CorsPolicy {
  constructor(
    /**
     * The effective CORS options
     */
    public readonly config: CorsConfig = { ...DEFAULT_CORS_CONFIG }
  ) {}

  /**
   * Determine whether the request carries a browser Origin header, i.e. it
   * is a cross-origin request at all
   * Laravel: CorsService::isCorsRequest()
   */
  isCorsRequest(request: Request): boolean {
    return request.header('origin') !== undefined;
  }

  /**
   * Determine whether the request is a CORS preflight: an OPTIONS carrying
   * both Origin and Access-Control-Request-Method
   * Laravel: CorsService::isPreflightRequest()
   */
  isPreflightRequest(request: Request): boolean {
    return (
      request.method === 'OPTIONS' &&
      request.header('origin') !== undefined &&
      request.header('access-control-request-method') !== undefined
    );
  }

  /**
   * Determine whether an origin is listed in allowed_origins, honouring the
   * `*` wildcard and `*`-patterns like `https://*.app.test`
   * Laravel: CorsService::isOriginAllowed()
   */
  isOriginAllowed(origin: string): boolean {
    return this.matchingOriginRule(origin) !== undefined;
  }

  /**
   * The value for Access-Control-Allow-Origin against the given request:
   * the `*` wildcard when no credentials are involved, otherwise the
   * concrete origin (never `*` together with credentials), or undefined
   * when the origin is not allowed and no CORS header should be sent
   */
  allowedOriginFor(request: Request): string | undefined {
    const origin = request.header('origin');

    if (origin === undefined || !this.isOriginAllowed(origin)) {
      return undefined;
    }

    if (this.config.supports_credentials) {
      return origin;
    }

    return this.matchingOriginRule(origin) === '*' ? '*' : origin;
  }

  /**
   * The headers an actual (non-preflight) CORS response carries: the allow-
   * origin decision, the credentials flag, and any exposed response headers
   * Laravel: CorsService::addActualRequestHeaders()
   */
  actualRequestHeaders(request: Request): Record<string, string> {
    const allowOrigin = this.allowedOriginFor(request);

    if (allowOrigin === undefined) {
      return {};
    }

    const headers: Record<string, string> = {
      'Access-Control-Allow-Origin': allowOrigin,
    };

    if (this.config.supports_credentials) {
      headers['Access-Control-Allow-Credentials'] = 'true';
    }

    if (this.config.exposed_headers.length > 0) {
      headers['Access-Control-Expose-Headers'] = this.config.exposed_headers.join(', ');
    }

    return headers;
  }

  /**
   * The full header set answering a preflight, including the method and
   * header grants and the cache lifetime
   * Laravel: CorsService::handlePreflightRequest()
   */
  preflightHeaders(request: Request): Record<string, string> {
    const allowOrigin = this.allowedOriginFor(request);

    if (allowOrigin === undefined) {
      return {};
    }

    const headers: Record<string, string> = {
      'Access-Control-Allow-Origin': allowOrigin,
      'Access-Control-Allow-Methods': this.allowedMethods(),
      'Access-Control-Allow-Headers': this.allowedHeadersFor(request),
    };

    if (this.config.supports_credentials) {
      headers['Access-Control-Allow-Credentials'] = 'true';
    }

    if (this.config.max_age > 0) {
      headers['Access-Control-Max-Age'] = String(this.config.max_age);
    }

    return headers;
  }

  /**
   * The methods advertised on a preflight: the configured list joined, or
   * the explicit verb list when `*` is combined with credentials (browsers
   * discard wildcard + credentials)
   */
  allowedMethods(): string {
    if (this.config.supports_credentials && this.config.allowed_methods.includes('*')) {
      return WILDCARD_METHODS.join(', ');
    }

    return this.config.allowed_methods.join(', ');
  }

  /**
   * The request headers a preflight may use: the requested list echoed when
   * the policy allows `*`, otherwise the intersection with the configured
   * allow-list; with nothing requested the configured list is advertised
   * Laravel: CorsService::getAllRequestHeaders()
   */
  allowedHeadersFor(request: Request): string {
    const requested = splitList(request.header('access-control-request-headers'));

    if (this.config.allowed_headers.includes('*')) {
      // Reflecting the requested set keeps credentialed preflights valid -
      // `*` is not a usable answer once credentials are involved
      if (requested.length > 0) {
        return requested.join(', ');
      }

      return this.config.supports_credentials ? '' : '*';
    }

    const allowed = new Set(this.config.allowed_headers.map((header) => header.toLowerCase()));
    const granted =
      requested.length > 0
        ? requested.filter((header) => allowed.has(header.toLowerCase()))
        : this.config.allowed_headers;

    return granted.join(', ');
  }

  /**
   * The allowed_origins entry that matches an origin - `undefined` when
   * none does
   */
  protected matchingOriginRule(origin: string): string | undefined {
    const candidate = origin.toLowerCase();

    for (const rule of this.config.allowed_origins) {
      if (rule === '*') {
        return rule;
      }

      if (rule.includes('*')) {
        const pattern = new RegExp(
          `^${rule
            .split('*')
            .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('.*')}$`,
          'i'
        );

        if (pattern.test(candidate)) {
          return rule;
        }

        continue;
      }

      if (rule.toLowerCase() === candidate) {
        return rule;
      }
    }

    return undefined;
  }
}

/**
 * Coerce an optional config entry to a string array, falling back to the
 * default when the application omitted (or malformed) it
 */
function toArray(value: unknown, fallback: string[]): string[] {
  if (value === undefined || value === null) {
    return [...fallback];
  }

  const list = Array.isArray(value) ? value : [value];

  return list.map((entry) => String(entry));
}

/**
 * Split a comma-separated header list into trimmed entries
 */
function splitList(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}
