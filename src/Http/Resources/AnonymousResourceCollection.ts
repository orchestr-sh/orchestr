/**
 * AnonymousResourceCollection
 *
 * The collection `SomeResource::collection($items)` produces: a
 * ResourceCollection that carries the resource class per instance instead of
 * in a static, so applications never have to declare one collection class
 * per resource.
 * Illuminate\Http\Resources\Json\AnonymousResourceCollection
 */

import { JsonResource, registerResourceCollectionFactory } from './JsonResource';
import { ResourceCollection } from './ResourceCollection';

export class AnonymousResourceCollection extends ResourceCollection {
  /**
   * The resource class items are wrapped in, supplied by `collection()`
   */
  protected declares: new (item: any) => JsonResource;

  constructor(resource: any, collects: new (item: any) => JsonResource) {
    super(resource);
    this.declares = collects;
  }

  /**
   * Anonymous collections read the resource class off the instance
   */
  protected collectsWith(): (new (item: any) => JsonResource) | null {
    return this.declares;
  }
}

// JsonResource.collection() builds these; the registration lives on the leaf
// of the module graph so no class ever extends one that is still evaluating.
registerResourceCollectionFactory((resource, collects) => new AnonymousResourceCollection(resource, collects));
