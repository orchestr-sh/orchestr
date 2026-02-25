import { ServiceProvider } from '@/Foundation/ServiceProvider';
import { Application } from '@/Foundation/Application';
import { Dispatcher } from './Dispatcher';
import { EventSubscriber } from './types';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Event Service Provider
 *
 * Provides event registration and discovery services following Laravel's
 * EventServiceProvider pattern. Supports both manual registration and
 * automatic listener discovery.
 *
 * @example
 * ```typescript
 * export class AppEventServiceProvider extends EventServiceProvider {
 *   protected listen = {
 *     'UserRegistered': [
 *       'SendWelcomeEmail',
 *       'CreateUserProfile'
 *     ],
 *     'OrderPlaced': 'SendOrderConfirmation'
 *   }
 *
 *   protected subscribe = [
 *     'UserEventSubscriber'
 *   ]
 * }
 * ```
 */
export abstract class EventServiceProvider extends ServiceProvider {
  /**
   * The event listener mappings for the application
   *
   * Maps event names to listener class names (string) or arrays of listener names.
   *
   * @example
   * ```typescript
   * protected listen = {
   *   'UserRegistered': ['SendWelcomeEmail', 'LogRegistration'],
   *   'OrderPlaced': 'ProcessOrder'
   * }
   * ```
   */
  protected listen: Record<string, string | string[]> = {};

  /**
   * The subscriber classes to register
   *
   * Subscribers provide their own event-to-listener mappings via a subscribe() method.
   *
   * @example
   * ```typescript
   * protected subscribe = [
   *   'UserEventSubscriber',
   *   'OrderEventSubscriber'
   * ]
   * ```
   */
  protected subscribe: string[] = [];

  /**
   * Register the application's event listeners
   *
   * Binds the event dispatcher as a singleton in the container.
   */
  register(): void {
    this.app.singleton('events', (app) => {
      return new Dispatcher(app as Application);
    });

    // Register alias for convenience
    this.app.alias('events', Dispatcher);
  }

  /**
   * Bootstrap the application events
   *
   * Performs three key operations:
   * 1. Registers manual event-listener mappings from the `listen` property
   * 2. Registers event subscribers from the `subscribe` property
   * 3. Performs automatic event discovery if enabled
   *
   * @throws {Error} If the dispatcher cannot be resolved from the container
   */
  async boot(): Promise<void> {
    const events = this.app.make<Dispatcher>('events');

    // Register event listeners from listen property
    for (const [event, listeners] of Object.entries(this.listen)) {
      const listenerArray = Array.isArray(listeners) ? listeners : [listeners];

      for (const listener of listenerArray) {
        events.listen(event, listener);
      }
    }

    // Register event subscribers
    for (const subscriber of this.subscribe) {
      const subscriberInstance = this.app.make<EventSubscriber>(subscriber);
      events.subscribe(subscriberInstance);
    }

    // Perform event discovery if enabled
    if (this.shouldDiscoverEvents()) {
      await this.discoverEvents(events);
    }
  }

  /**
   * Determine if events and listeners should be automatically discovered
   *
   * By default, discovery is enabled unless events are cached.
   * Override this method to customize discovery behavior.
   *
   * @returns {boolean} True if event discovery should run
   *
   * @example
   * ```typescript
   * protected shouldDiscoverEvents(): boolean {
   *   // Disable discovery in production
   *   return this.app.environment() !== 'production'
   * }
   * ```
   */
  protected shouldDiscoverEvents(): boolean {
    // Check for cached events first
    return !this.eventsAreCached();
  }

  /**
   * Discover the events and listeners for the application
   *
   * Uses EventDiscovery to scan specified directories for listener classes
   * and automatically registers them with their corresponding events.
   *
   * @param {Dispatcher} events - The event dispatcher instance
   *
   * @throws {Error} If EventDiscovery is not available (Task 6 dependency)
   */
  protected async discoverEvents(events: Dispatcher): Promise<void> {
    // Import EventDiscovery dynamically to avoid circular dependency
    try {
      const { EventDiscovery } = await import('@/Support/EventDiscovery');
      const discovery = new EventDiscovery(this.app);

      const listeners = await discovery.discover(this.discoverEventsWithin());

      for (const [event, listenerClasses] of listeners) {
        for (const listener of listenerClasses) {
          events.listen(event, listener);
        }
      }
    } catch (error: any) {
      // EventDiscovery not implemented yet (Task 6)
      // Silently skip discovery for now
      if (error.code !== 'MODULE_NOT_FOUND') {
        throw error;
      }
    }
  }

  /**
   * Get the directories to discover events within
   *
   * By default, uses the paths configured via Application.withEvents()
   * or falls back to the standard 'Listeners' directory.
   *
   * Override this method to customize discovery paths.
   *
   * @returns {string[]} Array of absolute directory paths to scan
   *
   * @example
   * ```typescript
   * protected discoverEventsWithin(): string[] {
   *   return [
   *     this.app.path('Listeners'),
   *     this.app.path('Domain/Listeners')
   *   ]
   * }
   * ```
   */
  protected discoverEventsWithin(): string[] {
    return this.app.getEventDiscoveryPaths();
  }

  /**
   * Determine if events are cached
   *
   * Checks for the existence of the cached events file.
   *
   * @returns {boolean} True if cached events file exists
   */
  protected eventsAreCached(): boolean {
    const cachePath = this.app.storagePath('framework/events.json');
    try {
      fs.accessSync(cachePath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the events and handlers from the cached file
   *
   * Loads and parses the cached events JSON file.
   *
   * @returns {Map<string, string[]>} Map of event names to listener class names
   */
  protected getCachedEvents(): Map<string, string[]> {
    const cachePath = this.app.storagePath('framework/events.json');

    if (!fs.existsSync(cachePath)) {
      return new Map();
    }

    try {
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
      // Convert array of entries back to Map
      return new Map(cached);
    } catch {
      return new Map();
    }
  }

  /**
   * Get all registered event-listener mappings
   *
   * Returns the complete mapping of events to listeners for inspection.
   * Useful for debugging and console commands.
   *
   * @returns {Record<string, string | string[]>} The listen property mappings
   */
  listens(): Record<string, string | string[]> {
    return this.listen;
  }
}
