/**
 * AsCollection cast
 *
 * The stored JSON becomes a live `Collection`, and the Collection travels
 * back into the column as JSON on write. Passing an inner cast
 * (`AsCollection.of('decimal:2')`) runs every item through it, which is the
 * Laravel `AsCollection::using` shape.
 *
 * Laravel: Illuminate\Database\Eloquent\Casts\AsCollection
 */

import type { CastsAttributes } from '@/Database/Contracts/CastsAttributes';
import { Collection } from '@/Support/Collection';
import { CastRegistry, type CastDefinition } from './CastRegistry';

export class AsCollection implements CastsAttributes {
  constructor(protected inner?: CastDefinition) {}

  /**
   * A collection cast whose items travel through another cast.
   */
  static of(inner?: CastDefinition): AsCollection {
    return new AsCollection(inner);
  }

  get(model: any, key: string, value: any): any {
    if (value === null || value === undefined) {
      return value;
    }

    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    const collection = new Collection(parsed);
    const inner = this.innerCast();

    if (inner) {
      return new Collection(collection.all().map((item) => inner.get(model, key, item, rawAttributes(model))));
    }

    return collection;
  }

  set(model: any, key: string, value: any): any {
    if (value === null || value === undefined) {
      return value;
    }

    const items = value instanceof Collection ? value.all() : value;
    const inner = this.innerCast();

    if (inner && Array.isArray(items)) {
      return JSON.stringify(items.map((item) => inner.set(model, key, item, rawAttributes(model))));
    }

    return typeof items === 'string' ? items : JSON.stringify(items);
  }

  serialize(_model: any, _key: string, value: any): any {
    return value instanceof Collection ? value.toArray() : value;
  }

  protected innerCast(): CastsAttributes | undefined {
    return this.inner === undefined ? undefined : CastRegistry.resolve(this.inner);
  }
}

/**
 * The model's stored attribute bag, for inner casts that want to read
 * sibling columns. Models keep `attributes` protected; built-in casts read
 * it defensively rather than breaking on plain objects in tests.
 */
export function rawAttributes(model: any): Record<string, any> {
  return model && typeof model.attributes === 'object' ? model.attributes : {};
}
