import { Application } from '@/Foundation/Application';
import { ServiceProvider } from '@/Foundation/ServiceProvider';
import { Dispatcher } from './Dispatcher';
import { EventDiscoveryCache } from './EventDiscoveryCache';
import { registerListener, resolveRegisteredListener } from './ListenerRegistry';
import { EventSubscriber } from './types';

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
   * Performs four key operations:
   * 1. Registers manual event-listener mappings from the `listen` property
   * 2. Registers event subscribers from the `subscribe` property
   * 3. Loads cached event-listener mappings when present
   * 4. Otherwise performs automatic event discovery if enabled
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

    // Prefer the cached event map written by `event:cache`...
    if (this.eventsAreCached()) {
      for (const [event, listeners] of this.getCachedEvents()) {
        for (const listener of listeners) {
          // Rebind classes this process already knows (registry) so cached
          // string listeners resolve without a fresh discovery scan.
          const known = resolveRegisteredListener(listener);

          if (known !== undefined && known !== listener) {
            this.bindDiscoveredListener(listener, typeof known === 'string' ? undefined : known);
          }

          events.listen(event, listener);
        }
      }
    } else if (this.shouldDiscoverEvents()) {
      // ...and fall back to live discovery when nothing is cached
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
   * Discovered classes are bound into the container (and the listener
   * registry) under their discovery path so string listeners resolve at
   * dispatch time, including from queued `CallQueuedListener` jobs.
   *
   * @param {Dispatcher} events - The event dispatcher instance
   */
  protected async discoverEvents(events: Dispatcher): Promise<void> {
    // Import EventDiscovery dynamically to avoid circular dependency
    const { EventDiscovery } = await import('@/Support/EventDiscovery');
    const discovery = new EventDiscovery(this.app);

    const listeners = await discovery.discover(this.discoverEventsWithin());
    const classes = discovery.getDiscoveredClasses();

    for (const [event, listenerClasses] of listeners) {
      for (const listener of listenerClasses) {
        this.bindDiscoveredListener(listener, classes.get(listener));
        events.listen(event, listener);
      }
    }
  }

  /**
   * Make a discovered listener resolvable from its discovery-path string
   *
   * @param name - Discovery path used as the container/registry binding name
   * @param listenerClass - The class EventDiscovery loaded from the file, if any
   */
  protected bindDiscoveredListener(name: string, listenerClass?: any): void {
    if (listenerClass === undefined) {
      return;
    }

    registerListener(name, listenerClass);

    if (typeof listenerClass === 'function' && !this.app.bound(name)) {
      this.app.bind(name, () => new listenerClass());
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
    return this.getEventCache().exists();
  }

  /**
   * Get the events and handlers from the cached file
   *
   * Loads and parses the cached events JSON file.
   *
   * @returns {Map<string, string[]>} Map of event names to listener class names
   */
  protected getCachedEvents(): Map<string, string[]> {
    return this.getEventCache().load();
  }

  /**
   * Cache store for discovered event-listener mappings
   */
  protected getEventCache(): EventDiscoveryCache {
    return new EventDiscoveryCache(this.app);
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
