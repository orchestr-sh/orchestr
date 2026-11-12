/**
 * CacheHit Event
 *
 * Dispatched when a cache key is found.
 */

import { Event } from '@/Events/Event';

export class CacheHit extends Event {
  constructor(
    public readonly storeName: string,
    public readonly key: string,
    public readonly value: any,
    public readonly tags: string[] = []
  ) {
    super();
  }
}
