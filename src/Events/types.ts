import type { DispatcherContract } from './Contracts/Dispatcher';
import type { Event } from './Event';

/**
 * Listener Interface
 *
 * Defines the contract for class-based event listeners.
 * Listeners must implement a handle method that receives an event.
 *
 * @template TEvent - The event type this listener handles
 */
export interface ListenerInterface<TEvent extends Event = Event> {
  /**
   * Handle the event
   *
   * @param event - The event instance to handle
   * @returns Any value: `false` stops propagation when halting, other values are
   * collected as responses, `null`/`undefined` responses are skipped
   */
  handle(event: TEvent): unknown;
}

/**
 * Listener Closure Type
 *
 * A function that handles an event. Can return false to stop propagation.
 *
 * The parameter is intentionally widened to `any`: closures commonly type
 * their event parameter to the concrete event class, and TypeScript's
 * contravariant function-parameter checks would otherwise reject those
 * closures against `EventListener`. The dispatcher passes the dispatched
 * event as-is at runtime.
 *
 * @template TEvent - The event type this closure handles
 */
export type ListenerClosure<TEvent extends Event = Event> = (event: any) => unknown;

/**
 * Listener Class Constructor Type
 *
 * A class constructor whose instances expose a `handle` method. The
 * dispatcher instantiates these (per dispatch, through the container for
 * string references), mirroring Laravel's `Event::listen(X, Listener::class)`.
 *
 * @template TEvent - The event type this listener handles
 */
export type ListenerClass<TEvent extends Event = Event> = new (...args: any[]) => ListenerInterface<TEvent>;

/**
 * Event Listener Type
 *
 * Can be one of:
 * - A class instance implementing ListenerInterface
 * - A listener class constructor (instantiated by the dispatcher)
 * - A closure function
 * - A string reference to resolve from the container
 *
 * @template TEvent - The event type this listener handles
 */
export type EventListener<TEvent extends Event = Event> =
  | ListenerInterface<TEvent>
  | ListenerClass<TEvent>
  | ListenerClosure<TEvent>
  | string;

/**
 * Registered Listener Entry
 *
 * Internal representation of a listener once it has been registered with the
 * dispatcher. The `queued` flag mirrors Laravel's third argument to
 * `Event::listen()` and forces the listener through the queue even when the
 * class itself carries no runtime `ShouldQueue` markers.
 */
export interface RegisteredListener<TEvent extends Event = Event> {
  /** The listener as registered */
  listener: EventListener<TEvent>;

  /** Force this listener onto the queue regardless of its own markers */
  queued?: boolean;
}

/**
 * Event Name or Class Reference
 *
 * `listen()` accepts event names as strings (Laravel's wildcard patterns
 * included) or event class constructors, mirroring
 * `Event.listen(UserRegistered, Listener::class)`.
 */
export type EventNameOrClass = string | (new (...args: any[]) => Event);

/**
 * Event Subscriber Interface
 *
 * Subscribers can register multiple event listeners at once.
 * They return a mapping of event names to listener methods.
 */
export interface EventSubscriber {
  /**
   * Register event listeners
   *
   * @param events - The event dispatcher instance
   * @returns Mapping of event names to listeners, or void when the subscriber
   * registered its listeners through `events.listen()` directly
   */
  subscribe(events: DispatcherContract): void | Record<string, EventListener | EventListener[]>;
}

/**
 * Event Payload Type
 *
 * Additional arguments passed when dispatching events
 */
export type EventPayload = any[];

/**
 * Queued Listener Configuration
 *
 * Metadata for listeners that should be queued
 */
export interface QueuedListener {
  /** The listener class name */
  class: string;

  /** The event instance */
  event: Event;

  /** Number of times to retry */
  tries: number;

  /** Timeout in seconds */
  timeout: number;

  /** Delay before retrying (seconds or array of delays) */
  backoff: number | number[];
}
