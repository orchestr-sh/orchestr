/**
 * Encrypted cast
 *
 * `encrypted` stores ciphertext in the attributes - and therefore in the
 * database bindings - while every read path returns plaintext, using the
 * crypter the model resolves. Copying raw attributes never double-encrypts:
 * a value that already decrypts with the application key is left alone.
 *
 * Laravel: HasAttributes::castAttributeAsEncryptedString()
 */

import type { CastsAttributes } from '@/Database/Contracts/CastsAttributes';
import type { Encrypter } from '@/Encryption/Contracts/Encrypter';

export class EncryptedCast implements CastsAttributes {
  get(model: any, _key: string, value: any): any {
    if (value === null || value === undefined) {
      return value;
    }

    return this.crypter(model).decrypt(value);
  }

  set(model: any, _key: string, value: any): any {
    if (value === null || value === undefined) {
      return value;
    }

    if (typeof value === 'string' && this.isEncryptedPayload(model, value)) {
      return value;
    }

    return this.crypter(model).encrypt(value);
  }

  protected crypter(model: any): Encrypter {
    return model.crypter();
  }

  /**
   * Whether a string decrypts with the application key, marking it as an
   * existing encrypted payload rather than a new plaintext value.
   */
  protected isEncryptedPayload(model: any, value: string): boolean {
    try {
      this.crypter(model).decrypt(value, false);
      return true;
    } catch {
      return false;
    }
  }
}
