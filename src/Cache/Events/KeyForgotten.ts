/**
 * KeyForgotten Event
 *
 * Dispatched when a key is removed from the cache.
 */
export class KeyForgotten {
  constructor(
    public readonly storeName: string,
    public readonly key: string,
    public readonly tags: string[] = []
  ) {}
}
