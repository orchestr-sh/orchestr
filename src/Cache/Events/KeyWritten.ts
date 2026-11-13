/**
 * KeyWritten Event
 *
 * Dispatched when a value is written to the cache.
 */

import { Event } from '@/Events/Event';

export class KeyWritten extends Event {
  constructor(
    public readonly storeName: string,
    public readonly key: string,
    public readonly value: any,
    public readonly seconds: number | null,
    public readonly tags: string[] = []
  ) {
    super();
  }
}
