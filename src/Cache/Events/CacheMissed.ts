/**
 * CacheMissed Event
 *
 * Dispatched when a cache key is not found.
 */
export class CacheMissed {
  constructor(
    public readonly storeName: string,
    public readonly key: string,
    public readonly tags: string[] = []
  ) {}
}
