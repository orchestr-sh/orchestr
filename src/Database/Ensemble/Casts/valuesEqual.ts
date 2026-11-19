/**
 * Cast value comparison
 *
 * Dirty tracking needs to know whether two values mean the same thing once
 * they have been cast, not just whether their stored forms are byte-identical.
 * Encrypted payloads differ per write (random IV) yet decrypt to the same
 * plaintext; two `Date`s at the same instant are equal even though they are
 * distinct objects; JSON may re-serialize in a new key order. This walks the
 * cast values structurally so those edits are recognised as the no-ops they
 * are.
 */

function isPlainObject(value: any): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Objects that carry their own serialized shape - Collection, Stringable,
 * ArrayObject - are compared through it, the way PHP compares the value
 * after casting rather than the object identity.
 */
function unwrap(value: any): any {
  if (value && typeof value.jsonSerialize === 'function') {
    return value.jsonSerialize();
  }

  if (value && typeof value.getArrayCopy === 'function') {
    return value.getArrayCopy();
  }

  if (typeof value?.toJSON === 'function') {
    return value.toJSON();
  }

  return value;
}

export function valuesEqual(a: any, b: any): boolean {
  if (a === b) {
    return true;
  }

  if (a === null || b === null || a === undefined || b === undefined) {
    return false;
  }

  if (a instanceof Date || b instanceof Date) {
    if (!(a instanceof Date) || !(b instanceof Date)) {
      return false;
    }

    return a.getTime() === b.getTime();
  }

  const left = unwrap(a);
  const right = unwrap(b);

  if (left !== a || right !== b) {
    return valuesEqual(left, right);
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => valuesEqual(item, right[index]));
  }

  if (isPlainObject(left) && isPlainObject(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);

    if (leftKeys.length !== rightKeys.length) {
      return false;
    }

    return leftKeys.every((key) => rightKeys.includes(key) && valuesEqual(left[key], right[key]));
  }

  return false;
}
