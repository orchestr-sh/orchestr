/**
 * PaginationContext
 *
 * Holds the resolvers the paginators read the current request from, the way
 * Laravel's `Paginator::resolveCurrentPath()` reads the container-bound
 * request. The framework has no ambient "current request", so an application
 * (or a test) wires one in here; without it pagination falls back to the
 * root path with an empty query string.
 */

/**
 * The two request values pagination cares about: where the links point and
 * which query parameters they carry over.
 */
export interface CurrentPaginationRequest {
  path: string;
  query: Record<string, any>;
}

let requestResolver: (() => CurrentPaginationRequest | null) | null = null;

/**
 * Register the resolver that answers with the running request, or `null` to
 * clear it again.
 * Laravel: Paginator::resolveCurrentPathUsing() / PageResolver
 */
export function resolveCurrentRequestUsing(resolver: (() => CurrentPaginationRequest | null) | null): void {
  requestResolver = resolver;
}

/**
 * The path pagination URLs are built on
 */
export function currentRequestPath(): string {
  return requestResolver?.()?.path ?? '/';
}

/**
 * The query string parameters pagination URLs preserve
 */
export function currentRequestQuery(): Record<string, any> {
  return { ...(requestResolver?.()?.query ?? {}) };
}
