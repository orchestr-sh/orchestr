/**
 * CacheFlushed Event
 *
 * Dispatched after all items have been flushed from the cache.
 */

import { Event } from '@/Events/Event';

export class CacheFlushed extends Event {
  constructor(
    public readonly storeName: string,
    public readonly tags: string[] = []
  ) {
    super();
  }
}
