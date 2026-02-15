import type { Event } from './Event';
import type { DispatcherContract } from './Contracts/Dispatcher';

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
   * @returns void, false to stop propagation, or a Promise
   */
  handle(event: TEvent): void | false | Promise<void | false>;
}

/**
 * Listener Closure Type
 *
 * A function that handles an event. Can return false to stop propagation.
 *
 * @template TEvent - The event type this closure handles
 */
export type ListenerClosure<TEvent extends Event = Event> =
  (event: TEvent) => void | false | Promise<void | false>;

/**
 * Event Listener Type
 *
 * Can be one of:
 * - A class instance implementing ListenerInterface
 * - A closure function
 * - A string reference to resolve from the container
 *
 * @template TEvent - The event type this listener handles
 */
export type EventListener<TEvent extends Event = Event> =
  | ListenerInterface<TEvent>
  | ListenerClosure<TEvent>
  | string;

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
   * @returns Mapping of event names to listener methods/closures
   */
  subscribe(events: DispatcherContract): void | Record<string, string | string[]>;
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
