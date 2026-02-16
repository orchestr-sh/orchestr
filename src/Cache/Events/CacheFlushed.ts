/**
 * CacheFlushed Event
 *
 * Dispatched after all items have been flushed from the cache.
 */
export class CacheFlushed {
  constructor(
    public readonly storeName: string,
    public readonly tags: string[] = []
  ) {}
}
