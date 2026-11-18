/**
 * AsEncryptedCollection cast
 *
 * A JSON array whose every item is individually encrypted at rest and
 * decrypted into a `Collection` on read. This is Laravel's
 * `AsEncryptedCollection`: the whole list is one ciphertext-per-element
 * payload, so a reader without the key learns nothing about the items.
 *
 * Laravel: Illuminate\Database\Eloquent\Casts\AsEncryptedCollection
 */

import type { CastsAttributes } from '@/Database/Contracts/CastsAttributes';
import type { Encrypter } from '@/Encryption/Contracts/Encrypter';
import { Collection } from '@/Support/Collection';

export class AsEncryptedCollection implements CastsAttributes {
  get(model: any, _key: string, value: any): any {
    if (value === null || value === undefined) {
      return value;
    }

    const crypter = this.crypter(model);
    const items = typeof value === 'string' ? JSON.parse(value) : value;
    const list = Array.isArray(items) ? items : Object.values(items ?? {});

    return new Collection(list.map((item) => crypter.decrypt(item)));
  }

  set(model: any, _key: string, value: any): any {
    if (value === null || value === undefined) {
      return value;
    }

    const crypter = this.crypter(model);
    const items = value instanceof Collection ? value.all() : Array.isArray(value) ? value : Object.values(value);

    return JSON.stringify(items.map((item) => crypter.encrypt(item)));
  }

  serialize(_model: any, _key: string, value: any): any {
    return value instanceof Collection ? value.toArray() : value;
  }

  protected crypter(model: any): Encrypter {
    return model.crypter();
  }
}
