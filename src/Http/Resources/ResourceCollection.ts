/**
 * ResourceCollection
 *
 * Maps every item of a list - or of a paginator's page - through a resource
 * class, mirroring Illuminate\Http\Resources\Json\ResourceCollection. When
 * the wrapped value is a paginator its metadata rides along in the response:
 * wrapped collections get a `meta` sibling, unwrapped ones merge it beside
 * the items.
 */

import { AbstractPaginator } from '@/Pagination/AbstractPaginator';
import { CursorPaginator } from '@/Pagination/CursorPaginator';
import { Collection } from '@/Support/Collection';
import { JsonResource } from './JsonResource';

export class ResourceCollection extends JsonResource {
  /**
   * The resource each item is wrapped in. Subclasses set their own; the
   * anonymous collection keeps it per instance instead.
   * Laravel: ResourceCollection::$collects
   */
  protected static collects: (new (item: any) => JsonResource) | null = null;

  /**
   * Resolve the resource class items are mapped through
   */
  protected collectsWith(): (new (item: any) => JsonResource) | null {
    return (this.constructor as typeof ResourceCollection).collects;
  }

  /**
   * The collection's items, serialised one resource at a time
   * Laravel: ResourceCollection::toArray()
   */
  toArray(request?: any): any[] {
    const collects = this.collectsWith();

    return this.resolveItems()
      .all()
      .map((item: any) => {
        if (collects !== null && !(item instanceof JsonResource)) {
          return new collects(item);
        }

        return item;
      });
  }

  /**
   * Read the underlying list: a paginator hands over its page items,
   * collections and plain arrays pass through, a lone value becomes one item
   */
  protected resolveItems(): Collection<any> {
    const resource = this.resource;

    if (resource instanceof AbstractPaginator || resource instanceof CursorPaginator) {
      return resource.items;
    }

    if (resource instanceof Collection) {
      return resource;
    }

    if (Array.isArray(resource)) {
      return new Collection(resource);
    }

    return new Collection(resource === null || resource === undefined ? [] : [resource]);
  }

  /**
   * The paginator behind this collection, if it wraps one
   */
  protected paginated(): AbstractPaginator<any> | CursorPaginator<any> | null {
    if (this.resource instanceof AbstractPaginator || this.resource instanceof CursorPaginator) {
      return this.resource as AbstractPaginator<any> | CursorPaginator<any>;
    }

    return null;
  }

  /**
   * With pagination metadata merged in: the `with`/`additional` bags plus,
   * for paginated resources, the paginator's meta - nested under `meta` when
   * the payload is wrapped, beside the items when it is not.
   * Laravel: ResourceCollection::paginationInformation()
   */
  protected extras(request?: any): Record<string, any> {
    const base = super.extras(request);
    const paginator = this.paginated();

    if (paginator === null) {
      return base;
    }

    const meta = paginator.meta();

    if (Object.keys(meta).length === 0) {
      return base;
    }

    const wrapKey = this.withWrappingInstance ? (this.constructor as typeof JsonResource).wrap : null;

    if (wrapKey !== null && wrapKey !== undefined) {
      return { ...base, meta };
    }

    return { ...base, ...meta };
  }
}
