/**
 * Encrypter Contract
 *
 * Defines the interface every encryption service must satisfy: authenticated
 * encryption of arbitrary values and of plain strings. Mirrors
 * Illuminate\Contracts\Encryption\Encrypter.
 */
export interface Encrypter {
  /**
   * Encrypt a value, JSON-serialising it first when `serialize` is on
   * Laravel: Crypt::encrypt()
   */
  encrypt(value: unknown, serialize?: boolean): string;

  /**
   * Decrypt a payload produced by encrypt(), undoing the serialisation when
   * `unserialize` is on
   * Laravel: Crypt::decrypt()
   */
  decrypt<T = any>(payload: string, unserialize?: boolean): T;

  /**
   * Encrypt a string without any serialisation layer
   * Laravel: Crypt::encryptString()
   */
  encryptString(value: string): string;

  /**
   * Decrypt a payload produced by encryptString(), insisting the plaintext
   * is a string
   * Laravel: Crypt::decryptString()
   */
  decryptString(payload: string): string;
}
