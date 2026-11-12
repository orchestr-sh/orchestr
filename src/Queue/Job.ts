/**
 * Job Base Class
 *
 * Base class for all queueable jobs in the application.
 * Mirrors Laravel's Job with Dispatchable, InteractsWithQueue,
 * Queueable, and SerializesModels traits.
 *
 * @example
 * ```typescript
 * class ProcessPodcast extends Job {
 *   public tries = 5;
 *   public timeout = 120;
 *   public backoff = [10, 30, 60];
 *
 *   constructor(public podcastId: number) {
 *     super();
 *   }
 *
 *   async handle(): Promise<void> {
 *     // Process podcast...
 *   }
 *
 *   async failed(error: Error): Promise<void> {
 *     console.error('Failed:', error);
 *   }
 * }
 *
 * // Dispatch
 * await ProcessPodcast.dispatch(podcastId);
 * await ProcessPodcast.dispatch(podcastId).onQueue('high').delay(60);
 * ```
 */

import { randomUUID } from 'crypto';
import type { QueueableJob } from './Contracts/QueueableJob';
import type { JobMiddleware } from './Middleware/JobMiddleware';

export abstract class Job implements QueueableJob {
  /**
   * The unique identifier for the job
   */
  public uuid: string;

  /**
   * The name of the connection the job should be sent to
   */
  public connection?: string;

  /**
   * The name of the queue the job should be sent to
   */
  public queue?: string;

  /**
   * The number of seconds before the job should be processed
   */
  public delay?: number | Date;

  /**
   * The number of times the job may be attempted
   */
  public tries?: number = 1;

  /**
   * The maximum number of unhandled exceptions to allow before failing
   */
  public maxExceptions?: number;

  /**
   * The number of seconds the job can run before timing out
   */
  public timeout?: number = 60;

  /**
   * The number of seconds to wait before retrying the job
   */
  public backoff?: number | number[];

  /**
   * The timestamp after which the job should no longer be retried
   */
  public retryUntil?: Date;

  /**
   * Indicate if the job should be marked as failed on timeout
   */
  public failOnTimeout?: boolean = false;

  /**
   * Indicate if the job should be dispatched after all database transactions have committed
   */
  public afterCommit?: boolean = false;

  /**
   * Internal: the job ID from the queue driver
   */
  public jobId?: string;

  /**
   * Internal: the number of times the job has been attempted
   */
  public attempts: number = 0;

  /**
   * Internal: whether the job has been deleted
   */
  protected _deleted: boolean = false;

  /**
   * Internal: whether the job has been released
   */
  protected _released: boolean = false;

  /**
   * Internal: the release delay
   */
  protected _releaseDelay: number = 0;

  /**
   * Internal: whether the job has been marked as failed
   */
  protected _failed: boolean = false;

  /**
   * Internal: the cancellation signal installed by the worker while the
   * job is executing. Underscore-prefixed, so it is never serialized.
   */
  protected _signal?: AbortSignal;

  constructor() {
    this.uuid = randomUUID();
  }

  /**
   * Execute the job
   */
  abstract handle(...args: any[]): Promise<void> | void;

  /**
   * Handle a job failure
   */
  failed?(error: Error): Promise<void> | void;

  /**
   * Get the middleware the job should pass through
   */
  middleware?(): JobMiddleware[];

  /**
   * The cancellation signal for the current run, when executed by a worker.
   *
   * The signal is aborted when the job exceeds its timeout. Cooperative
   * jobs should watch it (directly or via the argument passed to
   * `handle()`) and stop early; see the process-isolation note on
   * `Worker.executeWithTimeout()` for non-cooperative jobs.
   */
  get signal(): AbortSignal | undefined {
    return this._signal;
  }

  /**
   * Determine whether the worker has requested cancellation (timeout)
   */
  get cancelled(): boolean {
    return this._signal?.aborted === true;
  }

  /**
   * Install the cancellation signal. Called by the Worker before execution.
   */
  setCancellationSignal(signal: AbortSignal): void {
    this._signal = signal;
  }

  /**
   * Get the display name of the job
   */
  displayName(): string {
    return this.constructor.name;
  }

  /**
   * Delete the job from the queue
   */
  delete(): void {
    this._deleted = true;
  }

  /**
   * Release the job back onto the queue after a delay
   */
  release(delay: number = 0): void {
    this._released = true;
    this._releaseDelay = delay;
  }

  /**
   * Mark the job as failed
   */
  fail(error?: Error): void {
    this._failed = true;
    if (error && this.failed) {
      this.failed(error);
    }
  }

  /**
   * Determine if the job has been deleted
   */
  isDeleted(): boolean {
    return this._deleted;
  }

  /**
   * Determine if the job has been released
   */
  isReleased(): boolean {
    return this._released;
  }

  /**
   * Get the release delay
   */
  getReleaseDelay(): number {
    return this._releaseDelay;
  }

  /**
   * Determine if the job has been marked as failed
   */
  hasFailed(): boolean {
    return this._failed;
  }

  /**
   * Determine if the job has exceeded the maximum number of attempts
   */
  hasExceededMaxAttempts(): boolean {
    if (this.tries && this.attempts >= this.tries) {
      return true;
    }

    if (this.retryUntil && new Date() >= this.retryUntil) {
      return true;
    }

    return false;
  }

  /**
   * Get the number of seconds to wait before retrying the job
   */
  getBackoffDelay(attempt: number): number {
    const backoff = this.backoff;

    if (backoff === undefined || backoff === null) {
      return 0;
    }

    if (typeof backoff === 'number') {
      return backoff;
    }

    if (Array.isArray(backoff)) {
      return backoff[Math.min(attempt - 1, backoff.length - 1)] ?? 0;
    }

    return 0;
  }

  /**
   * Serialize the job for queue storage
   */
  toJSON(): Record<string, any> {
    const data: Record<string, any> = {
      _class: this.constructor.name,
    };

    const properties = Object.getOwnPropertyNames(this);

    for (const prop of properties) {
      // Skip internal properties
      if (prop.startsWith('_')) continue;

      const value = (this as any)[prop];

      if (value !== undefined) {
        data[prop] = this.serializeValue(value);
      }
    }

    return data;
  }

  /**
   * Serialize a value for JSON storage
   */
  protected serializeValue(value: any): any {
    if (value === null || value === undefined) {
      return value;
    }

    if (value instanceof Date) {
      return { _type: 'Date', value: value.toISOString() };
    }

    if (typeof value === 'object' && typeof value.toJSON === 'function') {
      return value.toJSON();
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.serializeValue(item));
    }

    if (typeof value === 'object') {
      const serialized: Record<string, any> = {};
      for (const [key, val] of Object.entries(value)) {
        serialized[key] = this.serializeValue(val);
      }
      return serialized;
    }

    return value;
  }

  /**
   * Restore a job from serialized data
   */
  static fromJSON<T extends Job>(this: typeof Job & (new (...args: any[]) => T), data: Record<string, any>): T {
    const instance = Object.create(this.prototype);

    for (const [key, value] of Object.entries(data)) {
      if (key === '_class') continue;
      instance[key] = Job.deserializeValue(value);
    }

    return instance;
  }

  /**
   * Deserialize a value from JSON
   */
  protected static deserializeValue(value: any): any {
    if (value === null || value === undefined) {
      return value;
    }

    if (typeof value === 'object' && value._type) {
      switch (value._type) {
        case 'Date':
          return new Date(value.value);
        default:
          return value;
      }
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.deserializeValue(item));
    }

    if (typeof value === 'object') {
      const deserialized: Record<string, any> = {};
      for (const [key, val] of Object.entries(value)) {
        deserialized[key] = this.deserializeValue(val);
      }
      return deserialized;
    }

    return value;
  }

  /**
   * Static dispatch methods (applied by applyJobDispatchable)
   * These are typed via the JobClass type helper below
   */
  static dispatch: (...args: any[]) => any;
  static dispatchSync: (...args: any[]) => Promise<void>;
  static dispatchIf: (condition: boolean | (() => boolean), ...args: any[]) => any;
  static dispatchUnless: (condition: boolean | (() => boolean), ...args: any[]) => any;
  static dispatchAfterResponse: (...args: any[]) => void;
}

/**
 * Type helper for Job classes with static dispatch methods
 */
export type JobClass<T extends Job = Job> = typeof Job & {
  new (...args: any[]): T;
  dispatch(...args: any[]): import('./PendingDispatch').PendingDispatch;
  dispatchSync(...args: any[]): Promise<void>;
  dispatchIf(condition: boolean | (() => boolean), ...args: any[]): import('./PendingDispatch').PendingDispatch | null;
  dispatchUnless(
    condition: boolean | (() => boolean),
    ...args: any[]
  ): import('./PendingDispatch').PendingDispatch | null;
  dispatchAfterResponse(...args: any[]): void;
};

// Apply dispatch methods
import { applyJobDispatchable } from './Concerns/Dispatchable';
applyJobDispatchable(Job);
