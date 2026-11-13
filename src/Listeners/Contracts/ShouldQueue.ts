import type { Event as EventLike } from '@/Events/Event';

/**
 * Should Queue Interface
 *
 * Marks a listener as queueable, allowing it to be processed asynchronously
 * through the queue system instead of synchronously during event dispatch.
 *
 * TypeScript interfaces are erased at compile time, so the dispatcher also
 * honours runtime markers: set `queued = true` on the listener class (or pass
 * `true` as the third argument to `Event.listen()`), or declare any of the
 * queue configuration properties below, and the listener is treated as
 * queueable. `implements ShouldQueue` on its own documents the intent and
 * type-checks the configuration properties.
 *
 * @example
 * ```typescript
 * class SendWelcomeEmail implements ShouldQueue {
 *   public readonly queued = true;
 *   public connection = 'redis';
 *   public queue = 'emails';
 *   public tries = 3;
 *   public timeout = 60;
 *
 *   async handle(event: UserRegistered): Promise<void> {
 *     await this.emailService.send(event.user.email, 'Welcome!');
 *   }
 *
 *   async failed(event: UserRegistered, error: Error): Promise<void> {
 *     console.error('Failed to send welcome email:', error);
 *   }
 * }
 * ```
 */
export interface ShouldQueue {
  /**
   * Runtime marker flagging the listener as queueable
   *
   * Interfaces vanish at runtime, so declare `public readonly queued = true`
   * (or register with `Event.listen(event, listener, true)`) to make the
   * dispatcher push the listener through the queue.
   */
  readonly queued?: true;

  /**
   * Delay pushing this queued listener until the active database transaction
   * commits (see `ShouldQueueAfterCommit`)
   */
  readonly afterCommit?: true;

  /**
   * The name of the connection the job should be sent to
   *
   * @example 'redis', 'database', 'sqs'
   */
  connection?: string;

  /**
   * The name of the queue the job should be sent to
   *
   * @example 'emails', 'notifications', 'default'
   */
  queue?: string;

  /**
   * The number of seconds before the job should be processed
   */
  delay?: number;

  /**
   * The number of times the job may be attempted
   *
   * @default 1
   */
  tries?: number;

  /**
   * The maximum number of seconds the job can run
   *
   * @default 60
   */
  timeout?: number;

  /**
   * The number of seconds to wait before retrying the job
   * Can be a single value or an array for progressive backoff
   *
   * @example
   * ```typescript
   * backoff = 10; // Wait 10 seconds between retries
   * backoff = [10, 30, 60]; // Progressive backoff
   * ```
   */
  backoff?: number | number[];

  /**
   * Determine the connection to send the job to
   *
   * @returns The connection name
   *
   * @example
   * ```typescript
   * viaConnection(): string {
   *   return this.isUrgent ? 'redis' : 'database';
   * }
   * ```
   */
  viaConnection?(): string;

  /**
   * Determine the queue to send the job to
   *
   * @returns The queue name
   *
   * @example
   * ```typescript
   * viaQueue(): string {
   *   return this.priority === 'high' ? 'priority' : 'default';
   * }
   * ```
   */
  viaQueue?(): string;

  /**
   * Determine the delay for the queued job
   *
   * @param event - The event that triggered this listener
   * @returns Delay in seconds
   *
   * @example
   * ```typescript
   * withDelay(event: UserRegistered): number {
   *   return event.user.isPremium ? 0 : 300; // Premium users get instant processing
   * }
   * ```
   */
  withDelay?(event: EventLike): number;

  /**
   * Determine if the listener should be queued
   *
   * @param event - The event that triggered this listener
   * @returns True if should be queued, false to execute synchronously
   *
   * @example
   * ```typescript
   * shouldQueue(event: OrderPlaced): boolean {
   *   return event.order.total > 1000; // Only queue for large orders
   * }
   * ```
   */
  shouldQueue?(event: EventLike): boolean;

  /**
   * Handle a job failure
   *
   * @param event - The event that triggered this listener
   * @param exception - The exception that caused the failure
   *
   * @example
   * ```typescript
   * async failed(event: UserRegistered, error: Error): Promise<void> {
   *   await this.logError(event.user.id, error);
   *   await this.notifyAdmin(error);
   * }
   * ```
   */
  failed?(event: EventLike, exception: Error): void | Promise<void>;
}

/**
 * Type guard to check if a listener implements ShouldQueue
 *
 * Recognises class constructors carrying a static/prototype `queued` marker,
 * and instances with a `queued` marker or any of the queue configuration
 * properties from the contract.
 *
 * @param listener - The listener to check
 * @returns True if listener implements ShouldQueue
 */
export function isShouldQueue(listener: any): listener is ShouldQueue {
  if (typeof listener === 'function') {
    return listener.queued === true || (listener.prototype != null && listener.prototype.queued === true);
  }

  return (
    listener !== null &&
    typeof listener === 'object' &&
    (listener.queued === true ||
      'connection' in listener ||
      'queue' in listener ||
      'tries' in listener ||
      typeof listener.viaConnection === 'function' ||
      typeof listener.viaQueue === 'function' ||
      typeof listener.shouldQueue === 'function')
  );
}
