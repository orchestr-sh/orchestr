/**
 * TagSet
 *
 * Manages a set of cache tags and their namespaces.
 * Used by TaggedCache to prefix keys with tag identifiers.
 *
 * Mirrors Laravel's Illuminate\Cache\TagSet.
 */

import { randomUUID } from 'crypto';
import type { Store } from '../Contracts/Store';

export class TagSet {
  constructor(
    protected store: Store,
    protected names: string[]
  ) {}

  /**
   * Get the tag namespace for all tags combined
   */
  async getNamespace(): Promise<string> {
    const ids: string[] = [];

    for (const name of this.names) {
      ids.push(await this.tagId(name));
    }

    return ids.join('|');
  }

  /**
   * Get the unique tag identifier for a tag name
   */
  protected async tagId(name: string): Promise<string> {
    const tagKey = this.tagKey(name);
    const existing = await this.store.get(tagKey);

    if (existing) {
      return existing;
    }

    // Create a new tag ID
    const id = randomUUID().replace(/-/g, '').substring(0, 12);
    await this.store.forever(tagKey, id);
    return id;
  }

  /**
   * Get the tag identifier key
   */
  tagKey(name: string): string {
    return `tag:${name}:key`;
  }

  /**
   * Reset all tag identifiers (used for flushing)
   */
  async reset(): Promise<void> {
    for (const name of this.names) {
      await this.store.forever(this.tagKey(name), randomUUID().replace(/-/g, '').substring(0, 12));
    }
  }

  /**
   * Flush all tag identifier keys
   */
  async flush(): Promise<void> {
    await this.reset();
  }

  /**
   * Get the tag names
   */
  getNames(): string[] {
    return this.names;
  }
}
