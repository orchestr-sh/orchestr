/**
 * Encrypter
 *
 * Authenticated symmetric encryption on `node:crypto` using AES-256-GCM.
 * Payloads are Laravel-style: a base64-encoded JSON document carrying the
 * initialisation vector, the ciphertext and the GCM authentication tag -
 * every field individually base64 encoded:
 *
 *   {"iv": "...", "value": "...", "tag": "..."}
 *
 * GCM authenticates the ciphertext, so `decrypt()` refuses tampered or
 * foreign-key payloads with a DecryptException instead of handing back
 * garbage. Values are JSON-serialised before encryption unless called with
 * `serialize = false` (the string-only path of encryptString()).
 *
 * Laravel: Illuminate\Encryption\Encrypter
 *
 * @example
 * ```typescript
 * const crypt = new Encrypter('base64:' + require('crypto').randomBytes(32).toString('base64'));
 *
 * crypt.decrypt(crypt.encrypt({ a: 1 }));           // { a: 1 }
 * crypt.decryptString(crypt.encryptString('hi'));   // 'hi'
 * ```
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import type { Encrypter as EncrypterContract } from '@/Encryption/Contracts/Encrypter';
import { APP_KEY_LENGTH, parseAppKey } from '@/Support/AppKey';
import { DecryptException } from './DecryptException';
import { MissingAppKeyException } from './MissingAppKeyException';

/**
 * The only cipher this port implements, matching Laravel's AES-256-GCM
 */
export type Cipher = 'AES-256-GCM';

/**
 * Node's algorithm name per supported cipher
 */
const NODE_ALGORITHMS: Record<Cipher, 'aes-256-gcm'> = {
  'AES-256-GCM': 'aes-256-gcm',
};

/**
 * GCM's recommended nonce length in bytes
 */
const IV_LENGTH = 12;

export class Encrypter implements EncrypterContract {
  /**
   * The raw key bytes, validated at construction time
   */
  protected key: Buffer;

  constructor(
    key: string | Buffer,
    protected cipher: Cipher = 'AES-256-GCM'
  ) {
    if (!NODE_ALGORITHMS[this.cipher]) {
      throw new Error(`The [${this.cipher}] cipher is not supported by the Encrypter.`);
    }

    this.key = this.parseKey(key);
  }

  /**
   * Encrypt a value, JSON-serialising it first when `serialize` is on
   * Laravel: Crypt::encrypt()
   */
  encrypt(value: unknown, serialize: boolean = true): string {
    return this.encryptPayload(this.toPlaintext(value, serialize));
  }

  /**
   * Decrypt a payload back into its original value
   * Laravel: Crypt::decrypt()
   */
  decrypt<T = any>(payload: string, unserialize: boolean = true): T {
    const plaintext = this.decryptPayload(payload);

    if (!unserialize) {
      return plaintext as T;
    }

    try {
      return JSON.parse(plaintext) as T;
    } catch (error) {
      throw new DecryptException('The payload is invalid.', { cause: error });
    }
  }

  /**
   * Encrypt a plain string without the serialisation layer
   * Laravel: Crypt::encryptString()
   */
  encryptString(value: string): string {
    if (typeof value !== 'string') {
      throw new TypeError(
        'The Encrypter can only encrypt strings without serialisation. Pass a string to encryptString().'
      );
    }

    return this.encryptPayload(value);
  }

  /**
   * Decrypt a payload produced by encryptString()
   * Laravel: Crypt::decryptString()
   */
  decryptString(payload: string): string {
    return this.decryptPayload(payload);
  }

  /**
   * The raw key bytes this encrypter signs and decrypts with
   * Laravel: Encrypter::getKey()
   */
  getKey(): Buffer {
    return this.key;
  }

  /**
   * The cipher name in use
   * Laravel: Encrypter::getSchema() / supportedCipherKeyLengths
   */
  getCipher(): Cipher {
    return this.cipher;
  }

  /**
   * Parse and length-check the application key, failing fast so a bad
   * APP_KEY surfaces at boot rather than at first decrypt
   */
  protected parseKey(key: string | Buffer): Buffer {
    const parsed = parseAppKey(key);

    if (!parsed) {
      throw new MissingAppKeyException();
    }

    if (parsed.length !== APP_KEY_LENGTH) {
      throw new Error(
        `Unsupported cipher or incorrect key length. The [${this.cipher}] cipher requires a 32-byte ` +
          `APP_KEY, got ${parsed.length}. Provide a raw 32-character key, or base64-encode ` +
          `one (e.g. "base64:" + crypto.randomBytes(32).toString("base64")).`
      );
    }

    return parsed;
  }

  /**
   * Render the value as the string that actually gets encrypted
   */
  protected toPlaintext(value: unknown, serialize: boolean): string {
    if (!serialize) {
      if (typeof value !== 'string') {
        throw new TypeError(
          'The Encrypter can only encrypt strings without serialisation. Call encrypt(value) with serialize enabled, or use encryptString().'
        );
      }

      return value;
    }

    const json = JSON.stringify(value);

    if (json === undefined) {
      throw new TypeError('The Encrypter cannot serialise this value to JSON.');
    }

    return json;
  }

  /**
   * Seal a plaintext string into an authenticated payload
   */
  protected encryptPayload(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(NODE_ALGORITHMS[this.cipher], this.key, iv);

    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return Buffer.from(
      JSON.stringify({
        iv: iv.toString('base64'),
        value: ciphertext.toString('base64'),
        tag: tag.toString('base64'),
      })
    ).toString('base64');
  }

  /**
   * Open a payload, letting the GCM tag reject tampering
   */
  protected decryptPayload(payload: string): string {
    if (typeof payload !== 'string' || payload === '') {
      throw new DecryptException();
    }

    const parsed = this.parsePayload(payload);

    try {
      const decipher = createDecipheriv(NODE_ALGORITHMS[this.cipher], this.key, parsed.iv);
      decipher.setAuthTag(parsed.tag);

      return Buffer.concat([decipher.update(parsed.value), decipher.final()]).toString('utf8');
    } catch (error) {
      // A wrong key, a mutated byte or a foreign payload all land here -
      // GCM authentication is the single gate
      throw new DecryptException('The payload is invalid.', { cause: error });
    }
  }

  /**
   * Decode the base64 JSON payload into its buffers
   */
  private parsePayload(payload: string): { iv: Buffer; value: Buffer; tag: Buffer } {
    let decoded: unknown;

    try {
      decoded = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
    } catch (error) {
      throw new DecryptException('The payload is invalid.', { cause: error });
    }

    if (
      decoded === null ||
      typeof decoded !== 'object' ||
      typeof (decoded as any).iv !== 'string' ||
      typeof (decoded as any).value !== 'string' ||
      typeof (decoded as any).tag !== 'string'
    ) {
      throw new DecryptException('The payload is invalid.');
    }

    return {
      iv: Buffer.from((decoded as any).iv, 'base64'),
      value: Buffer.from((decoded as any).value, 'base64'),
      tag: Buffer.from((decoded as any).tag, 'base64'),
    };
  }
}
