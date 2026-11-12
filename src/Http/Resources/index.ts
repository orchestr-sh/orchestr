/**
 * Http Resources
 *
 * The API resource layer: `JsonResource` shapes one model,
 * `ResourceCollection` maps a list (or a paginator's page) through a resource
 * class, and `AnonymousResourceCollection` is what
 * `SomeResource::collection($items)` hands back.
 */

export { JsonResource, MISSING_VALUE } from './JsonResource';
export type { ResourceCollectionFactory } from './JsonResource';
export { ResourceCollection } from './ResourceCollection';
export { AnonymousResourceCollection } from './AnonymousResourceCollection';
