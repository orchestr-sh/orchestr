/**
 * CacheMissed Event
 *
 * Dispatched when a cache key is not found.
 */

import { Event } from '@/Events/Event';

export class CacheMissed extends Event {
  constructor(
    public readonly storeName: string,
    public readonly key: string,
    public readonly tags: string[] = []
  ) {
    super();
  }
}
