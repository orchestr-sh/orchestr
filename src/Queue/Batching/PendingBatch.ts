/**
 * PendingBatch
 *
 * Fluent builder for creating a batch of jobs.
 * Jobs in a batch can run concurrently, with callbacks
 * for progress, completion, and failure.
 *
 * Mirrors Laravel's Illuminate\Bus\PendingBatch.
 *
 * @example
 * ```typescript
 * const batch = await Bus.batch([
 *   new ImportCSVRow(1),
 *   new ImportCSVRow(2),
 *   new ImportCSVRow(3),
 * ])
 *   .name('Import CSV')
 *   .then((batch) => console.log('All done!'))
 *   .catch((batch, error) => console.error('Failed:', error))
 *   .finally((batch) => console.log('Batch finished'))
 *   .onQueue('imports')
 *   .dispatch();
 * ```
 */

import type { Job } from '@/Queue/Job';
import type { Application } from '@/Foundation/Application';
import type { QueueManager } from '@/Queue/QueueManager';
import { Batch } from './Batch';

export class PendingBatch {
  protected _name: string = '';
  protected _connection?: string;
  protected _queue?: string;
  protected _thenCallbacks: Array<(batch: Batch) => void | Promise<void>> = [];
  protected _catchCallbacks: Array<(batch: Batch, error: Error) => void | Promise<void>> = [];
  protected _finallyCallbacks: Array<(batch: Batch) => void | Promise<void>> = [];
  protected _allowFailures: boolean = false;

  constructor(
    protected app: Application,
    protected jobs: Job[]
  ) {}

  /**
   * Set the name for the batch
   */
  name(name: string): this {
    this._name = name;
    return this;
  }

  /**
   * Set the connection for all jobs in the batch
   */
  onConnection(connection: string): this {
    this._connection = connection;
    return this;
  }

  /**
   * Set the queue for all jobs in the batch
   */
  onQueue(queue: string): this {
    this._queue = queue;
    return this;
  }

  /**
   * Register a callback for when all jobs in the batch complete
   */
  then(callback: (batch: Batch) => void | Promise<void>): this {
    this._thenCallbacks.push(callback);
    return this;
  }

  /**
   * Register a callback for when a job in the batch fails
   */
  catch(callback: (batch: Batch, error: Error) => void | Promise<void>): this {
    this._catchCallbacks.push(callback);
    return this;
  }

  /**
   * Register a callback for when the batch finishes (success or failure)
   */
  finally(callback: (batch: Batch) => void | Promise<void>): this {
    this._finallyCallbacks.push(callback);
    return this;
  }

  /**
   * Allow the batch to continue processing even if a job fails
   */
  allowFailures(allow: boolean = true): this {
    this._allowFailures = allow;
    return this;
  }

  /**
   * Dispatch the batch
   */
  async dispatch(): Promise<Batch> {
    const manager = this.app.make<QueueManager>('queue');

    // Apply connection/queue to all jobs
    for (const job of this.jobs) {
      if (this._connection) {
        job.connection = this._connection;
      }
      if (this._queue) {
        job.queue = this._queue;
      }
    }

    // Create batch instance
    const batch = new Batch(manager, this._name, this.jobs.length, {
      thenCallbacks: this._thenCallbacks,
      catchCallbacks: this._catchCallbacks,
      finallyCallbacks: this._finallyCallbacks,
      allowFailures: this._allowFailures,
    });

    // Dispatch all jobs with batch metadata
    for (const job of this.jobs) {
      (job as any)._batchId = batch.id;
      await manager.dispatch(job);
    }

    return batch;
  }
}
