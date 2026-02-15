import type { Event } from './Event';
import type { DispatcherContract } from './Contracts/Dispatcher';

/**
 * Pending Dispatch
 *
 * A deferred dispatch helper that allows chaining configuration
 * before actually dispatching an event.
 *
 * This is useful for building fluent APIs around event dispatching,
 * similar to Laravel's job dispatching.
 *
 * @example
 * ```typescript
 * // Defer dispatch with configuration
 * const pending = new PendingDispatch(dispatcher, new UserRegistered(user));
 * pending
 *   .onConnection('redis')
 *   .onQueue('notifications')
 *   .delay(60)
 *   .dispatch();
 *
 * // Or dispatch immediately with configuration
 * PendingDispatch.for(dispatcher, new OrderPlaced(order))
 *   .delay(300)
 *   .dispatch();
 * ```
 */
export class PendingDispatch {
  /**
   * Event configuration options
   */
  protected options: {
    connection?: string;
    queue?: string;
    delay?: number;
  } = {};

  /**
   * Create a new pending dispatch instance
   *
   * @param dispatcher - The event dispatcher
   * @param event - The event to dispatch
   */
  constructor(
    protected dispatcher: DispatcherContract,
    protected event: Event
  ) {}

  /**
   * Static factory method for fluent API
   *
   * @param dispatcher - The event dispatcher
   * @param event - The event to dispatch
   * @returns PendingDispatch instance
   */
  static for(dispatcher: DispatcherContract, event: Event): PendingDispatch {
    return new PendingDispatch(dispatcher, event);
  }

  /**
   * Set the queue connection for the event
   *
   * Only applicable if the event's listeners are queued
   *
   * @param connection - Connection name
   * @returns This instance for chaining
   */
  onConnection(connection: string): this {
    this.options.connection = connection;
    return this;
  }

  /**
   * Set the queue for the event
   *
   * Only applicable if the event's listeners are queued
   *
   * @param queue - Queue name
   * @returns This instance for chaining
   */
  onQueue(queue: string): this {
    this.options.queue = queue;
    return this;
  }

  /**
   * Set the delay before dispatching
   *
   * @param delay - Delay in seconds
   * @returns This instance for chaining
   */
  delay(delay: number): this {
    this.options.delay = delay;
    return this;
  }

  /**
   * Set the delay before dispatching (alias for delay)
   *
   * @param delay - Delay in seconds
   * @returns This instance for chaining
   */
  afterDelay(delay: number): this {
    return this.delay(delay);
  }

  /**
   * Apply the configured options to the event
   *
   * @returns The configured event
   */
  protected applyOptions(): Event {
    if (this.options.connection) {
      this.event.connection = this.options.connection;
    }

    if (this.options.queue) {
      this.event.queue = this.options.queue;
    }

    if (this.options.delay) {
      this.event.delay = this.options.delay;
    }

    return this.event;
  }

  /**
   * Dispatch the event to all listeners
   *
   * @returns Array of results from listeners
   */
  dispatch(): any[] {
    const event = this.applyOptions();
    return this.dispatcher.dispatch(event);
  }

  /**
   * Dispatch the event until the first listener returns a non-null response
   *
   * @returns The first non-null response
   */
  until(): any {
    const event = this.applyOptions();
    return this.dispatcher.until(event);
  }

  /**
   * Conditionally dispatch the event
   *
   * @param condition - Boolean or function returning boolean
   * @returns Array of results or empty array
   */
  dispatchIf(condition: boolean | (() => boolean)): any[] {
    const shouldDispatch = typeof condition === 'function' ? condition() : condition;

    if (shouldDispatch) {
      return this.dispatch();
    }

    return [];
  }

  /**
   * Dispatch unless the condition is true
   *
   * @param condition - Boolean or function returning boolean
   * @returns Array of results or empty array
   */
  dispatchUnless(condition: boolean | (() => boolean)): any[] {
    const shouldNotDispatch = typeof condition === 'function' ? condition() : condition;

    if (!shouldNotDispatch) {
      return this.dispatch();
    }

    return [];
  }
}
