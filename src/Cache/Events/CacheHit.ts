/**
 * CacheHit Event
 *
 * Dispatched when a cache key is found.
 */
export class CacheHit {
  constructor(
    public readonly storeName: string,
    public readonly key: string,
    public readonly value: any,
    public readonly tags: string[] = []
  ) {}
}
