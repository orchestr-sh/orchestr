/**
 * BroadcastException - a broadcast failed to reach its service.
 *
 * Laravel's Illuminate\Broadcasting\BroadcastException: the drivers wrap a
 * transport failure in this so callers see one error type regardless of the
 * underlying HTTP/queue client.
 */
export class BroadcastException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BroadcastException';

    // Keep instanceof working when the output is down-levelled
    Object.setPrototypeOf(this, BroadcastException.prototype);
  }
}
