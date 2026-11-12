/**
 * KeyForgotten Event
 *
 * Dispatched when a key is removed from the cache.
 */

import { Event } from '@/Events/Event';

export class KeyForgotten extends Event {
  constructor(
    public readonly storeName: string,
    public readonly key: string,
    public readonly tags: string[] = []
  ) {
    super();
  }
}
