/**
 * Should Queue Interface
 *
 * Marks a listener as queueable, allowing it to be processed asynchronously
 * through the queue system instead of synchronously during event dispatch.
 *
 * @example
 * ```typescript
 * class SendWelcomeEmail implements ShouldQueue {
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
  withDelay?(event: Event): number;

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
  shouldQueue?(event: Event): boolean;

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
  failed?(event: Event, exception: Error): void | Promise<void>;
}

/**
 * Type guard to check if a listener implements ShouldQueue
 *
 * @param listener - The listener to check
 * @returns True if listener implements ShouldQueue
 */
export function isShouldQueue(listener: any): listener is ShouldQueue {
  return (
    listener !== null &&
    typeof listener === 'object' &&
    (
      'connection' in listener ||
      'queue' in listener ||
      'tries' in listener ||
      typeof listener.viaConnection === 'function' ||
      typeof listener.viaQueue === 'function' ||
      typeof listener.shouldQueue === 'function'
    )
  );
}
