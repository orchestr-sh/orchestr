/**
 * CookieSessionStore
 *
 * Carries the whole session payload inside the session cookie itself,
 * mirroring Laravel's Illuminate\Session\CookieSessionHandler. The payload
 * is an HMAC-signed JSON envelope, so a tampered or forged cookie is
 * rejected instead of trusted; nothing is written server-side.
 */

import { createHmac, timingSafeEqual } from 'crypto';
import { BaseSessionStore } from './BaseSessionStore';

/**
 * The decoded envelope stored inside the cookie
 */
interface CookiePayload {
  sid: string;
  data: Record<string, any>;
  expires: number;
}

export class CookieSessionStore extends BaseSessionStore {
  /**
   * Data extracted from a verified request cookie, awaiting start()
   */
  private loadedPayload: Record<string, any> | null = null;

  /**
   * The session payload lives in the cookie; nothing to read server-side
   * until the request cookie has been offered via loadRawPayload()
   */
  protected read(): Record<string, any> | null {
    return this.loadedPayload;
  }

  /**
   * The response cookie carries the payload, so there is no server-side
   * write to perform
   */
  protected write(attributes: Record<string, any>): void {
    void attributes;
  }

  /**
   * Accept the raw cookie value from the request, verify its signature and
   * expiry, and adopt the session ID and data it carries
   */
  loadRawPayload(raw: string): void {
    const payload = this.parsePayload(raw);

    if (payload) {
      this.loadedPayload = payload.data;
      this.id = payload.sid;
    }
  }

  /**
   * Build the fresh signed envelope for the response cookie: the current
   * attributes, the session ID and the expiry stamped from the lifetime.
   * With expire_on_close the payload never expires server-side - the
   * browser-only cookie vanishes with it
   */
  getCookieValue(): string {
    const lifetime = Number(this.config.lifetime ?? 120);
    const persistent = !this.config.expire_on_close && lifetime > 0;
    const payload: CookiePayload = {
      sid: this.getId(),
      data: this.all(),
      expires: persistent ? this.currentTime() + lifetime * 60 : 0,
    };

    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');

    return `${encoded}.${this.sign(encoded)}`;
  }

  /**
   * Decode, verify and expiry-check a raw cookie payload; returns null for
   * anything unsigned, forged, malformed or stale
   */
  protected parsePayload(raw: string): CookiePayload | null {
    const separator = raw.lastIndexOf('.');

    if (separator <= 0 || separator === raw.length - 1) {
      return null;
    }

    const encoded = raw.slice(0, separator);
    const signature = raw.slice(separator + 1);

    if (!this.signMatches(encoded, signature)) {
      return null;
    }

    let payload: CookiePayload;

    try {
      payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf-8'));
    } catch {
      return null;
    }

    if (!payload || typeof payload !== 'object') {
      return null;
    }

    if (typeof payload.data !== 'object' || payload.data === null || typeof payload.sid !== 'string') {
      return null;
    }

    if (typeof payload.expires !== 'number') {
      return null;
    }

    if (payload.expires !== 0 && payload.expires <= this.currentTime()) {
      return null;
    }

    return payload;
  }

  /**
   * HMAC-SHA256 the encoded payload with the application key
   */
  protected sign(encoded: string): string {
    return createHmac('sha256', this.signingKey()).update(encoded).digest('base64url');
  }

  /**
   * Constant-time signature comparison
   */
  private signMatches(encoded: string, signature: string): boolean {
    try {
      const expected = Buffer.from(this.sign(encoded), 'base64url');
      const provided = Buffer.from(signature, 'base64url');

      return expected.length === provided.length && timingSafeEqual(expected, provided);
    } catch {
      return false;
    }
  }

  /**
   * The application key every signed session cookie is sealed with; the
   * cookie driver has no safe fallback, so a missing key is a hard error
   * like Laravel's APP_KEY requirement
   */
  private signingKey(): string {
    const key = this.config.key;

    if (!key || typeof key !== 'string') {
      throw new Error('No application encryption key has been specified.');
    }

    return key;
  }

  protected currentTime(): number {
    return Math.floor(Date.now() / 1000);
  }
}
