/**
 * ArrayObject
 *
 * The value end of the `AsArrayObject` cast: an object you can read and
 * write with array semantics, JSON-serializable as its underlying data.
 * Mirrors Laravel's Illuminate\Database\Eloquent\Casts\ArrayObject, which
 * extends SPL's ArrayObject with JsonSerializable.
 */

export class ArrayObject {
  protected data: Record<string, any> | any[];

  constructor(data: Record<string, any> | any[] = {}) {
    this.data = data;
  }

  /**
   * Build an ArrayObject from a JSON string, an array, an object, or an
   * existing ArrayObject.
   */
  static from(value: string | Record<string, any> | any[] | ArrayObject): ArrayObject {
    if (value instanceof ArrayObject) {
      return new ArrayObject(structuredCloneSafe(value.getArrayCopy()));
    }

    if (typeof value === 'string') {
      return new ArrayObject(JSON.parse(value));
    }

    return new ArrayObject(value);
  }

  /**
   * The plain array/object underneath
   */
  getArrayCopy(): Record<string, any> | any[] {
    return this.data;
  }

  /**
   * Number of entries (array length or object keys)
   */
  count(): number {
    return Array.isArray(this.data) ? this.data.length : Object.keys(this.data).length;
  }

  offsetGet(key: string | number): any {
    return (this.data as any)[key];
  }

  offsetSet(key: string | number, value: any): void {
    (this.data as any)[key] = value;
  }

  offsetExists(key: string | number): boolean {
    return (this.data as any)[key] !== undefined;
  }

  offsetUnset(key: string | number): void {
    if (Array.isArray(this.data)) {
      this.data.splice(Number(key), 1);
    } else {
      delete (this.data as Record<string, any>)[String(key)];
    }
  }

  /**
   * Replace the contents wholesale
   */
  exchangeArray(data: Record<string, any> | any[]): this {
    this.data = data;
    return this;
  }

  /**
   * The values as a plain list
   */
  toArray(): any[] {
    return Array.isArray(this.data) ? [...this.data] : Object.values(this.data);
  }

  /**
   * Hook used by JSON.stringify
   */
  toJSON(): Record<string, any> | any[] {
    return this.data;
  }

  toString(): string {
    return JSON.stringify(this.data);
  }
}

function structuredCloneSafe(value: Record<string, any> | any[]): Record<string, any> | any[] {
  return JSON.parse(JSON.stringify(value));
}
