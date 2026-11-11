/**
 * ArraySessionStore
 *
 * Keeps session payloads in process memory, mirroring Laravel's
 * Illuminate\Session\Store on the ArraySessionHandler: a dev/test driver
 * whose sessions vanish with the process but survive expiry rules.
 */

import { BaseSessionStore } from './BaseSessionStore';

/**
 * A stored payload with its expiry instant in unix seconds
 */
type ArrayEntry = {
  data: Record<string, any>;
  expires: number;
};

export class ArraySessionStore extends BaseSessionStore {
  /**
   * Process-wide payload registry keyed by session ID - module statics
   * stand in for the PHP $_SESSION backing array of the array driver
   */
  protected static sessions: Map<string, ArrayEntry> = new Map();

  protected read(): Record<string, any> | null {
    const entry = ArraySessionStore.sessions.get(this.id);

    if (!entry) {
      return null;
    }

    if (entry.expires !== 0 && entry.expires <= this.currentTime()) {
      ArraySessionStore.sessions.delete(this.id);
      return null;
    }

    return structuredClone(entry.data);
  }

  protected write(attributes: Record<string, any>): void {
    ArraySessionStore.sessions.set(this.id, {
      data: structuredClone(attributes),
      expires: this.expiresAt(),
    });
  }

  protected destroy(id: string): void {
    ArraySessionStore.sessions.delete(id);
  }

  /**
   * Wipe every stored session, primarily a test seam for resetting the
   * process-wide registry
   */
  static clear(): void {
    ArraySessionStore.sessions.clear();
  }

  /**
   * Unix seconds at which the payload expires; 0 keeps it for the process
   * lifetime like the array handler's internal garbage collector
   */
  protected expiresAt(): number {
    const lifetime = Number(this.config.lifetime ?? 120);

    return lifetime > 0 ? this.currentTime() + lifetime * 60 : 0;
  }

  protected currentTime(): number {
    return Math.floor(Date.now() / 1000);
  }
}
