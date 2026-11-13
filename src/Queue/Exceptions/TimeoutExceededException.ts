/**
 * TimeoutExceededException
 *
 * Thrown by the worker when a job runs past its configured timeout.
 * The worker aborts the job's cancellation signal and marks the job
 * as failed. Mirrors Laravel's Illuminate\Queue\TimeoutExceededException.
 */
export class TimeoutExceededException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutExceededException';
    Object.setPrototypeOf(this, TimeoutExceededException.prototype);
  }
}
