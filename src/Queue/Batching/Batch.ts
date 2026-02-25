/**
 * Batch
 *
 * Represents a batch of jobs being processed.
 * Tracks progress and fires callbacks on completion/failure.
 *
 * Mirrors Laravel's Illuminate\Bus\Batch.
 */

import { randomUUID } from 'crypto';
import type { QueueManager } from '@/Queue/QueueManager';

export interface BatchOptions {
  thenCallbacks: Array<(batch: Batch) => void | Promise<void>>;
  catchCallbacks: Array<(batch: Batch, error: Error) => void | Promise<void>>;
  finallyCallbacks: Array<(batch: Batch) => void | Promise<void>>;
  allowFailures: boolean;
}

export class Batch {
  public readonly id: string;
  public readonly createdAt: Date;

  protected _totalJobs: number;
  protected _pendingJobs: number;
  protected _failedJobs: number = 0;
  protected _failedJobIds: string[] = [];
  protected _cancelled: boolean = false;
  protected _finishedAt: Date | null = null;
  protected _options: BatchOptions;

  constructor(
    protected manager: QueueManager,
    public readonly name: string,
    totalJobs: number,
    options: BatchOptions
  ) {
    this.id = randomUUID();
    this.createdAt = new Date();
    this._totalJobs = totalJobs;
    this._pendingJobs = totalJobs;
    this._options = options;
  }

  /**
   * Get the total number of jobs in the batch
   */
  get totalJobs(): number {
    return this._totalJobs;
  }

  /**
   * Get the number of pending jobs
   */
  get pendingJobs(): number {
    return this._pendingJobs;
  }

  /**
   * Get the number of failed jobs
   */
  get failedJobs(): number {
    return this._failedJobs;
  }

  /**
   * Get the number of processed jobs
   */
  get processedJobs(): number {
    return this._totalJobs - this._pendingJobs;
  }

  /**
   * Get the batch progress percentage (0-100)
   */
  progress(): number {
    if (this._totalJobs === 0) return 100;
    return Math.round((this.processedJobs / this._totalJobs) * 100);
  }

  /**
   * Whether the batch has finished
   */
  finished(): boolean {
    return this._pendingJobs === 0;
  }

  /**
   * Whether the batch has been cancelled
   */
  cancelled(): boolean {
    return this._cancelled;
  }

  /**
   * Record a successful job completion
   */
  async recordSuccessfulJob(jobId: string): Promise<void> {
    this._pendingJobs = Math.max(0, this._pendingJobs - 1);

    if (this.finished()) {
      await this.fireThenCallbacks();
      await this.fireFinallyCallbacks();
      this._finishedAt = new Date();
    }
  }

  /**
   * Record a failed job
   */
  async recordFailedJob(jobId: string, error: Error): Promise<void> {
    this._failedJobs++;
    this._failedJobIds.push(jobId);
    this._pendingJobs = Math.max(0, this._pendingJobs - 1);

    // Fire catch callbacks
    await this.fireCatchCallbacks(error);

    if (!this._options.allowFailures) {
      this.cancel();
    }

    if (this.finished()) {
      await this.fireFinallyCallbacks();
      this._finishedAt = new Date();
    }
  }

  /**
   * Cancel the batch
   */
  cancel(): void {
    this._cancelled = true;
  }

  /**
   * Fire the then callbacks
   */
  protected async fireThenCallbacks(): Promise<void> {
    for (const callback of this._options.thenCallbacks) {
      try {
        await callback(this);
      } catch (error) {
        console.error('[Queue] Error in batch then callback:', error);
      }
    }
  }

  /**
   * Fire the catch callbacks
   */
  protected async fireCatchCallbacks(error: Error): Promise<void> {
    for (const callback of this._options.catchCallbacks) {
      try {
        await callback(this, error);
      } catch (callbackError) {
        console.error('[Queue] Error in batch catch callback:', callbackError);
      }
    }
  }

  /**
   * Fire the finally callbacks
   */
  protected async fireFinallyCallbacks(): Promise<void> {
    for (const callback of this._options.finallyCallbacks) {
      try {
        await callback(this);
      } catch (error) {
        console.error('[Queue] Error in batch finally callback:', error);
      }
    }
  }

  /**
   * Convert to a plain object for inspection
   */
  toJSON(): Record<string, any> {
    return {
      id: this.id,
      name: this.name,
      totalJobs: this._totalJobs,
      pendingJobs: this._pendingJobs,
      failedJobs: this._failedJobs,
      processedJobs: this.processedJobs,
      progress: this.progress(),
      cancelled: this._cancelled,
      createdAt: this.createdAt.toISOString(),
      finishedAt: this._finishedAt?.toISOString() || null,
    };
  }
}
