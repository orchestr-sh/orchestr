/**
 * BaseSessionStore
 *
 * The shared behaviour every session store inherits: attribute access
 * with "dot" notation, the flash-data lifecycle and CSRF token
 * generation. Subclasses only decide where the payload lives between
 * requests - memory, a file, or the signed session cookie - by
 * implementing read()/write().
 *
 * Mirrors Illuminate\Session\Store; its handler half is the read()/write()
 * seam in this port.
 */

import type { Store } from '@/Session/Contracts/Store';
import { Arr } from '@/Support/Arr';
import { Str } from '@/Support/Str';

/**
 * The per-store configuration handed to a session driver factory.
 */
export interface SessionStoreConfig {
  driver: string;
  [key: string]: any;
}

/**
 * The reserved key prefix holding flash bookkeeping, like Laravel's _flash.
 */
const FLASH_OLD = '_flash.old';
const FLASH_NEW = '_flash.new';

/**
 * The reserved key holding the CSRF token, like Laravel's _token.
 */
const TOKEN_KEY = '_token';

export abstract class BaseSessionStore implements Store {
  /**
   * The session attributes for the current request
   */
  protected attributes: Record<string, any> = {};

  /**
   * Whether start() has loaded this store
   */
  private started = false;

  constructor(
    protected config: SessionStoreConfig,
    protected id: string = Str.random(40)
  ) {}

  getId(): string {
    return this.id;
  }

  isStarted(): boolean {
    return this.started;
  }

  /**
   * Load the stored payload and make sure a CSRF token exists, matching
   * Laravel: Store::start()
   */
  start(): void {
    if (this.started) {
      return;
    }

    this.attributes = this.read() ?? {};

    if (!this.has(TOKEN_KEY)) {
      this.regenerateToken();
    }

    this.started = true;
  }

  /**
   * Age the flash data and persist the payload under the current session
   * ID, matching Laravel: Store::save()
   */
  save(): void {
    this.ageFlashData();
    this.write(this.attributes);
  }

  all(): Record<string, any> {
    return this.attributes;
  }

  get<T = any>(key: string, defaultValue?: T): T | undefined {
    return Arr.get<T>(this.attributes, key, defaultValue);
  }

  put(key: string, value: any): void {
    Arr.set(this.attributes, key, value);
  }

  set(key: string, value: any): void {
    this.put(key, value);
  }

  has(key: string): boolean {
    return this.get(key) !== undefined && this.get(key) !== null;
  }

  missing(key: string): boolean {
    return !this.has(key);
  }

  forget(key: string | string[]): void {
    Arr.forget(this.attributes, Array.isArray(key) ? key : [key]);
  }

  /**
   * Remove every session attribute, matching Laravel: Store::flush()
   */
  flush(): void {
    this.attributes = {};
  }

  /**
   * Swap the session ID for a fresh one - with a fresh CSRF token - while
   * keeping the session data, discarding the old session's storage,
   * matching Laravel: Store::regenerate() combined with the auth guard's
   * migrate(true). Authentication flows call this so a session ID handed
   * out before login cannot be replayed after it (session fixation).
   */
  regenerate(): void {
    this.destroy(this.id);
    this.id = Str.random(40);
    this.regenerateToken();
  }

  /**
   * Discard all session data, the session ID and its storage, matching
   * Laravel: Store::invalidate()
   */
  invalidate(): void {
    this.flush();
    this.regenerate();
  }

  /**
   * Write a value that will be available for exactly one subsequent
   * request, matching Laravel: Store::flash()
   */
  flash(key: string, value: any = true): void {
    this.put(key, value);

    if (key !== '_flash') {
      this.mergeNewFlashes([key]);
      this.removeFromOldFlashData([key]);
    }
  }

  /**
   * Keep every flash entry alive for one more request, matching Laravel:
   * Store::reflash()
   */
  reflash(): void {
    this.mergeNewFlashes(this.flashKeys(FLASH_OLD));
    this.put(FLASH_OLD, []);
  }

  /**
   * Keep the given flash keys alive for one more request, matching
   * Laravel: Store::keep()
   */
  keep(keys?: string | string[]): void {
    const list = keys === undefined ? [] : Array.isArray(keys) ? keys : [keys];
    this.mergeNewFlashes(list);
    this.removeFromOldFlashData(list);
  }

  /**
   * Forget the keys flashed for the previous request and roll the new
   * flash set into the old one; save() calls it before persisting,
   * matching Laravel: Store::ageFlashData()
   */
  ageFlashData(): void {
    this.forget(this.flashKeys(FLASH_OLD));
    this.put(FLASH_OLD, this.flashKeys(FLASH_NEW));
    this.put(FLASH_NEW, []);
  }

  /**
   * Get the session's CSRF token, generating it when the session has just
   * been flushed or never started, matching Laravel: Store::token()
   */
  token(): string {
    let token = this.get<string>(TOKEN_KEY);

    if (!token) {
      token = this.regenerateToken();
    }

    return token;
  }

  /**
   * Replace the CSRF token with a fresh one, matching Laravel:
   * Store::regenerateToken()
   */
  regenerateToken(): string {
    const token = Str.random(40);
    this.put(TOKEN_KEY, token);

    return token;
  }

  /**
   * Stores whose payload lives outside the cookie return the session ID as
   * the cookie value; the cookie driver overrides this with its payload
   */
  getCookieValue(): string {
    return this.id;
  }

  /**
   * Load the payload persisted for this session, or null when there is
   * none (or it has expired)
   */
  protected abstract read(): Record<string, any> | null;

  /**
   * Persist the payload under this store's session ID
   */
  protected abstract write(attributes: Record<string, any>): void;

  /**
   * Remove persisted storage for the given session ID; ID-carrying stores
   * override this, cookie-carried sessions have nothing server-side to
   * destroy
   */
  protected destroy(id: string): void {
    void id;
  }

  /**
   * Read one of the flash bookkeeping arrays, treating anything that is
   * not an array as empty
   */
  private flashKeys(key: string): string[] {
    const value = this.get<string[]>(key);

    return Array.isArray(value) ? value : [];
  }

  /**
   * Merge keys into the pending (new) flash set without duplicates
   */
  private mergeNewFlashes(keys: string[]): void {
    const merged = Array.from(new Set([...this.flashKeys(FLASH_NEW), ...keys]));
    this.put(FLASH_NEW, merged);
  }

  /**
   * Drop keys from the expiring (old) flash set so they survive to the
   * next request
   */
  private removeFromOldFlashData(keys: string[]): void {
    this.put(
      FLASH_OLD,
      this.flashKeys(FLASH_OLD).filter((each) => !keys.includes(each))
    );
  }
}
