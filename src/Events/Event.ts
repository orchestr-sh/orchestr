/**
 * Event Base Class
 *
 * Base class for all events in the application
 * Provides serialization support and broadcasting capabilities
 *
 * @example
 * ```typescript
 * class UserRegistered extends Event {
 *   constructor(public readonly user: User) {
 *     super();
 *   }
 * }
 *
 * // Dispatch the event
 * UserRegistered.dispatch(user);
 * ```
 */

/**
 * Abstract Event base class
 *
 * All application events should extend this class.
 * It provides:
 * - Event metadata storage
 * - Serialization for queueing
 * - Broadcasting support
 * - Static dispatch methods (via Dispatchable mixin)
 */
export abstract class Event {
  /**
   * Runtime registry of event classes by class name
   *
   * TypeScript interfaces are erased at compile time, so queued listeners
   * store the event as plain JSON plus its class name. The registry lets the
   * worker rebuild a typed instance from that payload. Subclasses register
   * themselves on instantiation, so any process that has dispatched an event
   * once can restore it; worker-only processes can call `registerClass`.
   */
  private static readonly classRegistry: Map<string, new (...args: any[]) => Event> = new Map();

  /**
   * Properties to exclude from serialization
   * Override in child classes to specify which properties should not be serialized
   */
  protected static serializable: string[] = [];

  /**
   * The name of the connection the job should be sent to
   * Used when queueing event listeners
   */
  public connection?: string;

  /**
   * The name of the queue the job should be sent to
   * Used when queueing event listeners
   */
  public queue?: string;

  /**
   * The number of seconds before the job should be processed
   * Used when queueing event listeners
   */
  public delay?: number;

  constructor() {
    // Registering on construction keeps the registry populated for any event
    // that has been dispatched at least once in this process, which covers
    // enqueue -> work within the same application instance.
    Event.registerClass(this.constructor as new (...args: any[]) => Event);
  }

  /**
   * Register an event class so queued listeners can restore it by name
   *
   * @param eventClass - Event class constructor to register
   * @returns The same class, so it can be used as a wrapper around a definition
   *
   * @example
   * ```typescript
   * Event.registerClass(UserRegistered);
   * ```
   */
  static registerClass<T extends new (...args: any[]) => Event>(eventClass: T): T {
    Event.classRegistry.set(eventClass.name, eventClass);
    return eventClass;
  }

  /**
   * Look up a previously registered event class by name
   *
   * @param name - Event class name
   * @returns The registered class constructor, or undefined when unknown
   */
  static registeredClass(name: string): (new (...args: any[]) => Event) | undefined {
    return Event.classRegistry.get(name);
  }

  /**
   * Convert event to JSON for queue serialization
   *
   * Serializes all public properties except those listed in the serializable array
   *
   * @returns Object representation of the event
   */
  toJSON(): Record<string, any> {
    const data: Record<string, any> = {
      _class: this.constructor.name,
    };

    // Get constructor
    const ctor = this.constructor as typeof Event;

    // Get all property names
    const properties = Object.getOwnPropertyNames(this);

    for (const prop of properties) {
      // Skip if in serializable exclusion list
      if (ctor.serializable.includes(prop)) {
        continue;
      }

      // Skip private properties (starting with _)
      if (prop.startsWith('_')) {
        continue;
      }

      // Get the value
      const value = (this as any)[prop];

      // Serialize the value
      if (value !== undefined) {
        data[prop] = this.serializeValue(value);
      }
    }

    return data;
  }

  /**
   * Serialize a value for JSON storage
   *
   * @param value - Value to serialize
   * @returns Serialized value
   */
  protected serializeValue(value: any): any {
    // Handle null/undefined
    if (value === null || value === undefined) {
      return value;
    }

    // Handle Date objects
    if (value instanceof Date) {
      return {
        _type: 'Date',
        value: value.toISOString(),
      };
    }

    // Handle objects with toJSON method
    if (typeof value === 'object' && typeof value.toJSON === 'function') {
      return value.toJSON();
    }

    // Handle arrays
    if (Array.isArray(value)) {
      return value.map((item) => this.serializeValue(item));
    }

    // Handle plain objects
    if (typeof value === 'object') {
      const serialized: Record<string, any> = {};
      for (const [key, val] of Object.entries(value)) {
        serialized[key] = this.serializeValue(val);
      }
      return serialized;
    }

    // Return primitives as-is
    return value;
  }

  /**
   * Recreate event from JSON
   *
   * This method should be overridden in child classes if custom deserialization is needed
   *
   * @param data - Serialized event data
   * @returns Event instance
   */
  static fromJSON<T extends Event>(this: typeof Event & (new (...args: any[]) => T), data: Record<string, any>): T {
    // Create a new instance without calling constructor
    const instance = Object.create(this.prototype);

    // Restore properties
    for (const [key, value] of Object.entries(data)) {
      if (key === '_class') continue;

      instance[key] = this.deserializeValue(value);
    }

    return instance;
  }

  /**
   * Deserialize a value from JSON
   *
   * @param value - Serialized value
   * @returns Deserialized value
   */
  protected static deserializeValue(value: any): any {
    // Handle null/undefined
    if (value === null || value === undefined) {
      return value;
    }

    // Already-rehydrated dates (e.g. restored inside a queue job payload)
    if (value instanceof Date) {
      return value;
    }

    // Handle special type markers
    if (typeof value === 'object' && value._type) {
      switch (value._type) {
        case 'Date':
          return new Date(value.value);
        default:
          return value;
      }
    }

    // Handle arrays
    if (Array.isArray(value)) {
      return value.map((item) => this.deserializeValue(item));
    }

    // Handle plain objects
    if (typeof value === 'object') {
      const deserialized: Record<string, any> = {};
      for (const [key, val] of Object.entries(value)) {
        deserialized[key] = this.deserializeValue(val);
      }
      return deserialized;
    }

    // Return primitives as-is
    return value;
  }

  /**
   * Get the broadcast channel name(s)
   *
   * Override in child classes to specify which channels this event should broadcast on
   *
   * @returns Channel name(s) or empty array for no broadcasting
   *
   * @example
   * ```typescript
   * broadcastOn(): string | string[] {
   *   return 'users.' + this.user.id;
   * }
   * ```
   */
  broadcastOn(): string | string[] {
    return [];
  }

  /**
   * Get the data to broadcast
   *
   * Override in child classes to customize the broadcast payload
   * By default, returns all public properties
   *
   * @returns Data to broadcast
   *
   * @example
   * ```typescript
   * broadcastWith(): Record<string, any> {
   *   return {
   *     userId: this.user.id,
   *     userName: this.user.name,
   *   };
   * }
   * ```
   */
  broadcastWith(): Record<string, any> {
    const data: Record<string, any> = {};

    // Get all property names
    const properties = Object.getOwnPropertyNames(this);

    for (const prop of properties) {
      // Skip private properties
      if (prop.startsWith('_')) {
        continue;
      }

      // Skip queue-related properties
      if (['connection', 'queue', 'delay'].includes(prop)) {
        continue;
      }

      const value = (this as any)[prop];
      if (value !== undefined) {
        data[prop] = value;
      }
    }

    return data;
  }

  /**
   * Get the broadcast event name
   *
   * Override in child classes to customize the event name sent to clients
   * By default, returns the class name
   *
   * @returns Event name for broadcasting
   *
   * @example
   * ```typescript
   * broadcastAs(): string {
   *   return 'user.registered';
   * }
   * ```
   */
  broadcastAs(): string {
    return this.constructor.name;
  }

  /**
   * Determine if this event should broadcast
   *
   * Override in child classes to conditionally broadcast events
   *
   * @returns True if event should broadcast
   */
  shouldBroadcast(): boolean {
    const channels = this.broadcastOn();
    return Array.isArray(channels) ? channels.length > 0 : !!channels;
  }
}

// Apply Dispatchable mixin to Event class
import { applyDispatchable } from './Concerns/Dispatchable';
applyDispatchable(Event);

/**
 * Type helper for Event classes with static dispatch methods
 *
 * Use this to get proper typing for your event classes:
 * @example
 * ```typescript
 * class UserRegistered extends Event {
 *   constructor(public user: User) {
 *     super();
 *   }
 * }
 *
 * // TypeScript will recognize these:
 * await UserRegistered.dispatch(user);
 * await UserRegistered.dispatchIf(condition, user);
 * ```
 */
export type EventClass<T extends Event = Event> = typeof Event & {
  new (...args: any[]): T;
  dispatch(...args: any[]): Promise<any[]>;
  dispatchIf(condition: boolean | (() => boolean), ...args: any[]): Promise<any[]>;
  dispatchUnless(condition: boolean | (() => boolean), ...args: any[]): Promise<any[]>;
  until(...args: any[]): Promise<any>;
};
