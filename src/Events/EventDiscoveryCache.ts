import { Application } from '../Foundation/Application';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

/**
 * Cache entry structure for discovered events
 */
export interface CachedEventEntry {
  /**
   * Event class name
   */
  event: string;

  /**
   * Array of listener class paths that handle this event
   */
  listeners: string[];

  /**
   * Timestamp when this entry was cached
   */
  cachedAt: number;
}

/**
 * Cache structure for all discovered events
 */
export interface EventCache {
  /**
   * Version of the cache format (for future compatibility)
   */
  version: string;

  /**
   * Timestamp when the cache was generated
   */
  generatedAt: number;

  /**
   * Map of event names to their cached entries
   */
  events: Record<string, CachedEventEntry>;
}

/**
 * EventDiscoveryCache
 *
 * Manages caching of discovered event-listener mappings to improve performance.
 * Cache is stored as JSON in the storage/framework directory.
 *
 * This prevents the need to scan and parse TypeScript files on every application
 * boot in production environments.
 *
 * @example
 * ```typescript
 * const cache = new EventDiscoveryCache(app)
 *
 * // Check if cache exists
 * if (cache.exists()) {
 *   const listeners = cache.load()
 * }
 *
 * // Store discovered listeners
 * cache.store(discoveredListeners)
 *
 * // Clear cache
 * cache.clear()
 * ```
 */
export class EventDiscoveryCache {
  /**
   * Current cache format version
   */
  private static readonly CACHE_VERSION = '1.0';

  /**
   * Default cache file path relative to storage directory
   */
  private static readonly CACHE_PATH = 'framework/events.json';

  constructor(protected app: Application) {}

  /**
   * Get the full path to the cache file
   *
   * @returns Absolute path to the events cache file
   */
  getCachePath(): string {
    return this.app.storagePath(EventDiscoveryCache.CACHE_PATH);
  }

  /**
   * Determine if the events cache file exists
   *
   * @returns True if cache file exists and is readable
   *
   * @example
   * ```typescript
   * if (cache.exists()) {
   *   // Use cached events
   * } else {
   *   // Discover events
   * }
   * ```
   */
  exists(): boolean {
    try {
      return existsSync(this.getCachePath());
    } catch {
      return false;
    }
  }

  /**
   * Load cached event-listener mappings
   *
   * Reads the cache file and returns a Map of event names to listener paths.
   * If the cache file doesn't exist or is invalid, returns an empty Map.
   *
   * @returns Map of event names to array of listener class paths
   *
   * @example
   * ```typescript
   * const listeners = cache.load()
   * // Returns: Map {
   * //   'UserRegistered' => ['Listeners/SendWelcomeEmail', 'Listeners/CreateUserProfile'],
   * //   'OrderPlaced' => ['Listeners/SendOrderConfirmation']
   * // }
   * ```
   */
  load(): Map<string, string[]> {
    if (!this.exists()) {
      return new Map();
    }

    try {
      const cachePath = this.getCachePath();
      const contents = readFileSync(cachePath, 'utf-8');
      const data: EventCache = JSON.parse(contents);

      // Validate cache version
      if (data.version !== EventDiscoveryCache.CACHE_VERSION) {
        if (this.app.isDebug()) {
          console.warn(`Event cache version mismatch. Expected ${EventDiscoveryCache.CACHE_VERSION}, got ${data.version}`);
        }
        return new Map();
      }

      // Convert cache format to Map
      const listeners = new Map<string, string[]>();
      for (const [eventName, entry] of Object.entries(data.events)) {
        listeners.set(eventName, entry.listeners);
      }

      return listeners;
    } catch (error) {
      if (this.app.isDebug()) {
        console.warn('Failed to load event cache:', error);
      }
      return new Map();
    }
  }

  /**
   * Store event-listener mappings in cache
   *
   * Writes the discovered listeners to the cache file in JSON format.
   * Creates the cache directory if it doesn't exist.
   *
   * @param listeners Map of event names to listener class paths
   * @returns True if cache was successfully written, false otherwise
   *
   * @example
   * ```typescript
   * const discovery = new EventDiscovery(app)
   * const listeners = await discovery.discover([app.path('Listeners')])
   * cache.store(listeners)
   * ```
   */
  store(listeners: Map<string, string[]>): boolean {
    try {
      const cachePath = this.getCachePath();
      const cacheDir = dirname(cachePath);

      // Create cache directory if it doesn't exist
      if (!existsSync(cacheDir)) {
        mkdirSync(cacheDir, { recursive: true });
      }

      // Build cache structure
      const cache: EventCache = {
        version: EventDiscoveryCache.CACHE_VERSION,
        generatedAt: Date.now(),
        events: {}
      };

      const now = Date.now();
      for (const [eventName, listenerList] of listeners) {
        cache.events[eventName] = {
          event: eventName,
          listeners: listenerList,
          cachedAt: now
        };
      }

      // Write cache file with pretty formatting for readability
      writeFileSync(
        cachePath,
        JSON.stringify(cache, null, 2),
        'utf-8'
      );

      return true;
    } catch (error) {
      if (this.app.isDebug()) {
        console.error('Failed to write event cache:', error);
      }
      return false;
    }
  }

  /**
   * Clear the events cache
   *
   * Deletes the cache file. This is typically called by the event:clear command
   * or when the cache needs to be invalidated.
   *
   * @returns True if cache was successfully cleared or didn't exist, false on error
   *
   * @example
   * ```typescript
   * cache.clear()
   * // Cache file deleted, discovery will run on next boot
   * ```
   */
  clear(): boolean {
    try {
      const cachePath = this.getCachePath();

      if (!existsSync(cachePath)) {
        return true; // Already cleared
      }

      const fs = require('fs');
      fs.unlinkSync(cachePath);
      return true;
    } catch (error) {
      if (this.app.isDebug()) {
        console.error('Failed to clear event cache:', error);
      }
      return false;
    }
  }

  /**
   * Get cache metadata
   *
   * Returns information about the cache without loading all entries.
   * Useful for displaying cache status.
   *
   * @returns Cache metadata or null if cache doesn't exist
   *
   * @example
   * ```typescript
   * const metadata = cache.getMetadata()
   * console.log(`Cache generated at: ${new Date(metadata.generatedAt)}`)
   * console.log(`Total events: ${Object.keys(metadata.events).length}`)
   * ```
   */
  getMetadata(): Pick<EventCache, 'version' | 'generatedAt'> & { eventCount: number } | null {
    if (!this.exists()) {
      return null;
    }

    try {
      const cachePath = this.getCachePath();
      const contents = readFileSync(cachePath, 'utf-8');
      const data: EventCache = JSON.parse(contents);

      return {
        version: data.version,
        generatedAt: data.generatedAt,
        eventCount: Object.keys(data.events).length
      };
    } catch (error) {
      if (this.app.isDebug()) {
        console.warn('Failed to read event cache metadata:', error);
      }
      return null;
    }
  }

  /**
   * Check if cache is stale based on a timestamp
   *
   * Useful for invalidating cache based on file modification times
   * or other external factors.
   *
   * @param threshold Timestamp in milliseconds. Cache is stale if older than this.
   * @returns True if cache exists and is older than threshold
   *
   * @example
   * ```typescript
   * // Check if cache is older than 1 hour
   * const oneHourAgo = Date.now() - (60 * 60 * 1000)
   * if (cache.isStale(oneHourAgo)) {
   *   cache.clear()
   *   // Re-discover events
   * }
   * ```
   */
  isStale(threshold: number): boolean {
    const metadata = this.getMetadata();

    if (!metadata) {
      return true; // No cache = stale
    }

    return metadata.generatedAt < threshold;
  }

  /**
   * Get statistics about the cache
   *
   * Returns detailed statistics about cached events and listeners.
   *
   * @returns Cache statistics or null if cache doesn't exist
   *
   * @example
   * ```typescript
   * const stats = cache.getStatistics()
   * console.log(`Total events: ${stats.totalEvents}`)
   * console.log(`Total listeners: ${stats.totalListeners}`)
   * ```
   */
  getStatistics(): {
    totalEvents: number;
    totalListeners: number;
    averageListenersPerEvent: number;
    largestEvent: { name: string; listenerCount: number } | null;
  } | null {
    if (!this.exists()) {
      return null;
    }

    try {
      const cachePath = this.getCachePath();
      const contents = readFileSync(cachePath, 'utf-8');
      const data: EventCache = JSON.parse(contents);

      let totalListeners = 0;
      let largestEvent: { name: string; listenerCount: number } | null = null;

      for (const [eventName, entry] of Object.entries(data.events)) {
        const listenerCount = entry.listeners.length;
        totalListeners += listenerCount;

        if (!largestEvent || listenerCount > largestEvent.listenerCount) {
          largestEvent = { name: eventName, listenerCount };
        }
      }

      const totalEvents = Object.keys(data.events).length;

      return {
        totalEvents,
        totalListeners,
        averageListenersPerEvent: totalEvents > 0 ? totalListeners / totalEvents : 0,
        largestEvent
      };
    } catch (error) {
      if (this.app.isDebug()) {
        console.warn('Failed to calculate cache statistics:', error);
      }
      return null;
    }
  }
}
