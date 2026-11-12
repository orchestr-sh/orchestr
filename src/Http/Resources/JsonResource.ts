/**
 * JsonResource
 *
 * The API resource layer: a thin serialisation boundary between models and
 * HTTP, mirroring Illuminate\Http\Resources\Json\JsonResource. Resources own
 * how a model's shape is rendered - including fields that come and go with
 * conditions, loaded relations, and counted aggregates - while query building
 * stays with the builder and pagination metadata stays with the paginators.
 */

import { aggregateAlias } from '@/Database/Ensemble/Aggregates';
import { AbstractPaginator } from '@/Pagination/AbstractPaginator';
import { CursorPaginator } from '@/Pagination/CursorPaginator';
import { JsonResponse } from '@/Routing/Responses/JsonResponse';
import { Collection } from '@/Support/Collection';

/**
 * Sentinel marking a field that should be dropped from the output entirely,
 * the marker Laravel's resource filter strips for unfulfilled conditions
 */
export const MISSING_VALUE = Symbol('orchestr.resource.missing');

/**
 * Marker wrapping data a `mergeWhen` wants spliced into its parent object
 */
const MERGE_MARKER = Symbol('orchestr.resource.merge');

/**
 * Factory hook the resources index wires once the collection classes exist:
 * `JsonResource.collection()` cannot import them at the top level without a
 * circular class definition (collections extend resources).
 */
export type ResourceCollectionFactory = (resource: any, collects: new (item: any) => JsonResource) => JsonResource;

let collectionFactory: ResourceCollectionFactory | null = null;

export function registerResourceCollectionFactory(factory: ResourceCollectionFactory): void {
  collectionFactory = factory;
}

/**
 * A condition, a value, or a closure evaluated against the wrapped resource
 */
type ConditionOrValue = any;

function evaluate(value: any, ...args: any[]): any {
  return typeof value === 'function' ? value(...args) : value;
}

export class JsonResource {
  /**
   * The wrapping key every resource response is nested under, or null to
   * leave payloads unwrapped. Subclasses set their own by redeclaring this
   * field; `withoutWrapping()` shadows it on the class it is called on.
   * Laravel: JsonResource::$wrap
   */
  protected static wrap: string | null = 'data';

  /**
   * The wrapped resource: a model, a list, or a paginator of them
   */
  public resource: any;

  /**
   * Data merged alongside the payload
   */
  private withData: Record<string, any> = {};

  /**
   * Additional data merged alongside the payload
   */
  private additionalData: Record<string, any> = {};

  /**
   * Per-instance opt-out of the wrapping key, used by
   * `SomeResource::collection($items)->withoutWrapping()`
   */
  protected withWrappingInstance: boolean = true;

  constructor(resource: any) {
    this.resource = resource;
  }

  /**
   * Create one resource - the `make` convenience on top of `new`
   * Laravel: JsonResource::make()
   */
  static make<T extends JsonResource>(this: new (resource: any) => T, resource: any): T {
    return new this(resource);
  }

  /**
   * Wrap a model, list, or paginator in a collection of this resource
   * Laravel: JsonResource::collection()
   */
  static collection(resource: any): JsonResource {
    if (collectionFactory === null) {
      throw new Error(
        'Resource collections are not registered: import from "@orchestr-sh/orchestr" or "@/Http/Resources" before calling collection().'
      );
    }

    return collectionFactory(resource, this as unknown as new (item: any) => JsonResource);
  }

  /**
   * Stop nesting payloads under the wrapping key
   * Laravel: JsonResource::withoutWrapping()
   */
  static withoutWrapping(): void {
    this.wrap = null;
  }

  /**
   * Restore the wrapping key on this class
   * Laravel: JsonResource::withWrapping()
   */
  static withWrapping(): void {
    this.wrap = 'data';
  }

  /**
   * The fields this resource renders
   * Laravel: JsonResource::toArray()
   */
  toArray(request?: any): any {
    return JsonResource.serialize(this.resource);
  }

  /**
   * Resolve the resource's value: the filtered, serialised form of
   * `toArray()`'s output - conditional fields applied, missing ones dropped
   * Laravel: JsonResource::resolve()
   */
  resolve(request?: any): any {
    return JsonResource.filter(this.toArray(request));
  }

  /**
   * Build the HTTP response: the resolved payload, wrapped under the
   * configured key with the `with`/`additional` data merged in
   * Laravel: JsonResource::toResponse()
   */
  response(request?: any): JsonResponse {
    return new JsonResponse(this.toJSONPayload(request));
  }

  /**
   * The JSON body this resource's response would write
   */
  toJSONPayload(request?: any): any {
    const resolved = this.resolve(request);
    const extras = this.extras(request);
    const wrapKey = this.withWrappingInstance ? (this.constructor as typeof JsonResource).wrap : null;

    if (wrapKey !== null && wrapKey !== undefined) {
      return { [wrapKey]: resolved, ...extras };
    }

    if (Object.keys(extras).length === 0) {
      return resolved;
    }

    if (Array.isArray(resolved)) {
      const merged: Record<string, any> = {};

      resolved.forEach((item, index) => {
        merged[index] = item;
      });

      return { ...merged, ...extras };
    }

    return { ...resolved, ...extras };
  }

  /**
   * JSON.stringify hook so a resource embedded in an object graph serialises
   * exactly as its response would
   */
  toJSON(): any {
    return this.toJSONPayload();
  }

  /**
   * Serialize this resource to a JSON string
   */
  toJson(spacing: number | string = 0): string {
    return JSON.stringify(this.toJSONPayload(), null, spacing);
  }

  /**
   * Data merged next to the payload in the response
   * Laravel: JsonResource::with()
   */
  with(data: Record<string, any>): this {
    Object.assign(this.withData, data);
    return this;
  }

  /**
   * Additional data merged next to the payload in the response
   * Laravel: JsonResource::additional()
   */
  additional(data: Record<string, any>): this {
    Object.assign(this.additionalData, data);
    return this;
  }

  /**
   * Stop nesting this instance's payload under the wrapping key
   * Laravel: AnonymousResourceCollection::withoutWrapping()
   */
  withoutWrapping(): this {
    this.withWrappingInstance = false;
    return this;
  }

  /**
   * Include the value when the condition passes, otherwise drop the field
   * (or fall back to the default)
   * Laravel: JsonResource::when()
   */
  when(condition: ConditionOrValue, value: ConditionOrValue, defaultValue: ConditionOrValue = MISSING_VALUE): any {
    return evaluate(condition, this.resource) ? evaluate(value, this.resource) : evaluate(defaultValue, this.resource);
  }

  /**
   * Splice the value's keys into the surrounding object when the condition
   * passes
   * Laravel: JsonResource::mergeWhen()
   */
  mergeWhen(condition: ConditionOrValue, value: ConditionOrValue): any {
    if (!evaluate(condition, this.resource)) {
      return MISSING_VALUE;
    }

    const merged = evaluate(value, this.resource);

    if (Array.isArray(merged)) {
      const pairs: Record<string, any> = {};

      for (let index = 0; index + 1 < merged.length; index += 2) {
        pairs[merged[index]] = merged[index + 1];
      }

      return { [MERGE_MARKER]: pairs } as Record<string, any>;
    }

    return { [MERGE_MARKER]: merged } as Record<string, any>;
  }

  /**
   * Include the value when the condition is truthy - the Laravel twin of
   * `when` for explicit existence checks
   * Laravel: JsonResource::whenHas()
   */
  whenHas(condition: ConditionOrValue, value: ConditionOrValue, defaultValue: ConditionOrValue = MISSING_VALUE): any {
    return this.when(condition, value, defaultValue);
  }

  /**
   * Include the relation's value only when it is already loaded, so a
   * resource never triggers lazy queries while rendering
   * Laravel: JsonResource::whenLoaded()
   */
  whenLoaded(
    relationship: string,
    callback?: (value: any) => any,
    defaultValue: ConditionOrValue = MISSING_VALUE
  ): any {
    if (!this.relationLoaded(relationship)) {
      return evaluate(defaultValue, this.resource);
    }

    const value = this.getRelationValue(relationship);

    return callback ? callback(value) : value;
  }

  /**
   * Include a counted relation's `{relation}_count` attribute when the query
   * loaded it with `withCount`
   * Laravel: JsonResource::whenCounted()
   */
  whenCounted(relationship: string, defaultValue: ConditionOrValue = MISSING_VALUE): any {
    const value = this.aggregatedAttribute(aggregateAlias(relationship, 'count', '*'));

    if (value === undefined) {
      return evaluate(defaultValue, this.resource);
    }

    return Number(value ?? 0);
  }

  /**
   * Include an eager-loaded aggregate's attribute (`withSum`, `withAvg`, ...)
   * when the query loaded it
   * Laravel: JsonResource::whenAggregated()
   */
  whenAggregated(
    relationship: string,
    column: string,
    aggregate: string,
    callback?: (value: any) => any,
    defaultValue: ConditionOrValue = MISSING_VALUE
  ): any {
    const value = this.aggregatedAttribute(aggregateAlias(relationship, aggregate, column));

    if (value === undefined) {
      return evaluate(defaultValue, this.resource);
    }

    return callback ? callback(value) : value;
  }

  /**
   * Whether the wrapped model has the relation loaded, dotted paths checked
   * hop by hop
   */
  protected relationLoaded(relationship: string): boolean {
    let current = this.resource;

    for (const segment of relationship.split('.')) {
      if (current === null || current === undefined || typeof current.relationLoaded !== 'function') {
        return false;
      }

      if (!current.relationLoaded(segment)) {
        return false;
      }

      current = current.getRelation(segment);
    }

    return true;
  }

  /**
   * Walk a dotted relation path through the loaded relations
   */
  protected getRelationValue(relationship: string): any {
    let current = this.resource;

    for (const segment of relationship.split('.')) {
      current = current.getRelation(segment);
    }

    return current;
  }

  /**
   * Read one attribute off the wrapped resource
   */
  protected aggregatedAttribute(name: string): any {
    if (this.resource === null || this.resource === undefined) {
      return undefined;
    }

    if (typeof this.resource.getAttribute === 'function') {
      return this.resource.getAttribute(name);
    }

    return this.resource[name];
  }

  /**
   * Data merged alongside the payload in `toJSONPayload`: the `with` and
   * `additional` bags; resource collections extend this with pagination
   * metadata
   */
  protected extras(request?: any): Record<string, any> {
    return { ...this.withData, ...this.additionalData };
  }

  /**
   * Turn a raw value into plain JSON data: resources resolve themselves,
   * models serialise through `toObject()`, collections and arrays map, plain
   * objects recurse.
   */
  static serialize(value: any): any {
    if (value === null || value === undefined) {
      return value;
    }

    if (value instanceof JsonResource) {
      return value.resolve();
    }

    if (value instanceof AbstractPaginator || value instanceof CursorPaginator) {
      return value.items.all().map((item: any) => JsonResource.serialize(item));
    }

    if (value instanceof Collection) {
      return value.all().map((item) => JsonResource.serialize(item));
    }

    if (Array.isArray(value)) {
      return value.map((item) => JsonResource.serialize(item));
    }

    if (typeof value.toObject === 'function') {
      return value.toObject();
    }

    if (JsonResource.isPlainObject(value)) {
      const plain: Record<string, any> = {};

      for (const [key, inner] of Object.entries(value)) {
        plain[key] = JsonResource.serialize(inner);
      }

      return plain;
    }

    return value;
  }

  /**
   * Apply the markers `toArray()` output may carry: `when`-defaults drop
   * their keys, `mergeWhen` splices its data in, and every remaining value
   * is serialised the way `serialize()` does.
   * Laravel: JsonResource::filter()
   */
  static filter(data: any): any {
    if (data === MISSING_VALUE) {
      return MISSING_VALUE;
    }

    // A pure marker (a `mergeWhen` used as a field value) unwraps in place;
    // the spread form (`...this.mergeWhen()`) leaves the marker's symbol on
    // an object that also carries its own keys, handled below
    if (JsonResource.isMergeMarker(data) && Object.keys(data).length === 0) {
      return JsonResource.filter((data as any)[MERGE_MARKER]);
    }

    if (data instanceof JsonResource) {
      return data.resolve();
    }

    if (data instanceof Collection) {
      return JsonResource.filter(data.all());
    }

    if (Array.isArray(data)) {
      return data
        .map((item) => JsonResource.filter(item))
        .filter((item) => item !== MISSING_VALUE)
        .map((item) => JsonResource.serialize(item));
    }

    if (JsonResource.isPlainObject(data)) {
      const filtered: Record<string, any> = {};

      for (const [key, value] of Object.entries(data)) {
        if (JsonResource.isMergeMarker(value)) {
          Object.assign(filtered, JsonResource.filter(value));
          continue;
        }

        const resolved = JsonResource.filter(value);

        if (resolved === MISSING_VALUE) {
          continue;
        }

        filtered[key] = resolved;
      }

      // Spread markers land last, the way object spreads apply
      if (JsonResource.isMergeMarker(data)) {
        Object.assign(filtered, JsonResource.filter((data as any)[MERGE_MARKER]));
      }

      return filtered;
    }

    return JsonResource.serialize(data);
  }

  /**
   * Whether a value came from `mergeWhen`
   */
  private static isMergeMarker(value: any): boolean {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }

    return Object.getOwnPropertySymbols(value).includes(MERGE_MARKER);
  }

  /**
   * Plain object detection: records made of data, not class instances with
   * their own serialisation
   */
  private static isPlainObject(value: any): boolean {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }

    const prototype = Object.getPrototypeOf(value);

    return prototype === Object.prototype || prototype === null;
  }
}
