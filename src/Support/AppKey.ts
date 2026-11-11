/**
 * Application key parsing
 *
 * Shared by the Encrypter and the URL signer: both consume `APP_KEY`, which
 * may arrive as a `base64:`-prefixed string (the Laravel convention), plain
 * base64 of 32 bytes, or a raw 32-byte key. Support/AppKey stays free of
 * framework imports so any layer can use it (SRP).
 */

import { MissingAppKeyException } from '@/Encryption/MissingAppKeyException';

/**
 * The key length AES-256-GCM requires
 */
export const APP_KEY_LENGTH = 32;

/**
 * Normalise an app key into raw bytes.
 *
 * - `base64:...`-prefixed strings are decoded
 * - other strings are treated as raw key material when their UTF-8 bytes
 *   are 32 long, and fall back to base64 decoding when those decode to
 *   exactly 32 bytes (Laravel apps commonly ship plain base64 keys)
 * - Buffers pass through
 *
 * @returns the parsed key bytes, or null when no key was provided
 */
export function parseAppKey(key: string | Buffer | null | undefined): Buffer | null {
  if (key === null || key === undefined) {
    return null;
  }

  if (Buffer.isBuffer(key)) {
    return key;
  }

  if (typeof key !== 'string' || key === '') {
    return null;
  }

  if (key.startsWith('base64:')) {
    return Buffer.from(key.slice('base64:'.length), 'base64');
  }

  const raw = Buffer.from(key, 'utf8');

  if (raw.length === APP_KEY_LENGTH) {
    return raw;
  }

  const decoded = Buffer.from(key, 'base64');

  // A string whose base64 form decodes to exactly 32 bytes is read as a
  // base64 key; anything else stays raw so the length check reports it
  if (decoded.length === APP_KEY_LENGTH && looksLikeBase64(key)) {
    return decoded;
  }

  return raw;
}

/**
 * Parse the key or fail with Laravel's missing-key exception
 */
export function requireAppKey(key: string | Buffer | null | undefined): Buffer {
  const parsed = parseAppKey(key);

  if (!parsed) {
    throw new MissingAppKeyException();
  }

  return parsed;
}

/**
 * Whether a string is plausibly a base64 encoding (checked up to the
 * 4-character quantum, which is all a 32-byte key can give)
 */
function looksLikeBase64(value: string): boolean {
  return /^[A-Za-z0-9+/]+={0,2}$/.test(value) && value.length % 4 === 0;
}
