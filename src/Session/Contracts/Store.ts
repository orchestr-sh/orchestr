/**
 * Store Contract
 *
 * Defines the interface every session store must satisfy: session data
 * access, lifecycle (start/save), regeneration, flash data and the CSRF
 * token. Drivers (array, file, cookie) differ only in where the payload
 * lives - the contract keeps the middleware and facade free of driver
 * specifics (OCP), mirroring Illuminate\Contracts\Session\Session.
 */
export interface Store {
  /**
   * Get the session ID
   * Laravel: Store::getId()
   */
  getId(): string;

  /**
   * Determine if the session has been started
   * Laravel: Store::isStarted()
   */
  isStarted(): boolean;

  /**
   * Load the session payload and make sure a CSRF token exists
   * Laravel: Store::start()
   */
  start(): void;

  /**
   * Age the flash data and persist the session payload
   * Laravel: Store::save()
   */
  save(): void;

  /**
   * Get all of the session data
   * Laravel: Store::all()
   */
  all(): Record<string, any>;

  /**
   * Get a value from the session using "dot" notation
   * Laravel: Store::get($key, $default)
   */
  get<T = any>(key: string, defaultValue?: T): T | undefined;

  /**
   * Put a value into the session using "dot" notation
   * Laravel: Store::put($key, $value) / Store::set()
   */
  put(key: string, value: any): void;

  /**
   * Alias of put()
   * Laravel: Store::set($key, $value)
   */
  set(key: string, value: any): void;

  /**
   * Determine if a session key exists and is not null
   * Laravel: Store::has($key)
   */
  has(key: string): boolean;

  /**
   * Determine if a session key is missing or null
   * Laravel: Store::missing($key)
   */
  missing(key: string): boolean;

  /**
   * Remove one or more items from the session
   * Laravel: Store::forget($key)
   */
  forget(key: string | string[]): void;

  /**
   * Remove all session data, keeping only the flash bookkeeping
   * Laravel: Store::flush()
   */
  flush(): void;

  /**
   * Regenerate the session ID (and CSRF token), keeping the session data
   * and discarding the old session's storage. Authentication flows call
   * this so a pre-login session ID cannot be reused as the authenticated
   * one (session fixation).
   * Laravel: Store::regenerate()
   */
  regenerate(): void;

  /**
   * Destroy the session: clear its data and its ID
   * Laravel: Store::invalidate()
   */
  invalidate(): void;

  /**
   * Put a key in the session that is available for one subsequent request
   * only
   * Laravel: Store::flash($key, $value)
   */
  flash(key: string, value?: any): void;

  /**
   * Keep the current flash data (old and new) alive for one more request
   * Laravel: Store::reflash()
   */
  reflash(): void;

  /**
   * Keep the given flash keys alive for one more request by moving them
   * out of the expiring set into the pending one
   * Laravel: Store::keep($keys)
   */
  keep(keys?: string | string[]): void;

  /**
   * Forget the keys flashed for the previous request and roll the pending
   * flash keys into the expiring set; save() calls it automatically
   * Laravel: Store::ageFlashData()
   */
  ageFlashData(): void;

  /**
   * Get the CSRF token, generating one the first time it is needed
   * Laravel: Store::token()
   */
  token(): string;

  /**
   * Replace the CSRF token with a freshly generated one
   * Laravel: Store::regenerateToken()
   */
  regenerateToken(): string;

  /**
   * The value stored in the session cookie for this session: the session
   * ID for ID-carrying drivers, the signed payload for the cookie driver
   */
  getCookieValue(): string;

  /**
   * Offer the raw cookie payload to a store that carries its session data
   * in the cookie itself (the cookie driver); called before start()
   */
  loadRawPayload?(raw: string): void;
}
