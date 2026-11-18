/**
 * BroadcastEvent - the queue payload that carries a broadcast event to a
 * worker for delivery.
 *
 * Mirrors Illuminate\Broadcasting\BroadcastEvent. A `ShouldBroadcast` event
 * dispatched while a queue connection is available is pushed as one of these;
 * the job normalises the event through the shared path (DRY) and hands the
 * result to the broadcaster resolved back from the manager. Like
 * SendQueuedMailable the job keeps a live reference, so the sync driver and
 * `Queue.fake()` deliver it in-process; the reference fields are underscore-
 * prefixed so `Job.toJSON()` skips them instead of corrupting payloads.
 */

import type { BroadcastManager } from '@/Broadcasting/BroadcastManager';
import { normalizeBroadcastEvent } from '@/Broadcasting/Concerns/NormalizesBroadcastEvent';
import { Job } from '@/Queue/Job';

export class BroadcastEvent extends Job {
  protected _manager: BroadcastManager;
  protected _event: any;

  constructor(manager: BroadcastManager, event: any) {
    super();

    this._manager = manager;
    this._event = event;
  }

  /**
   * The wrapped broadcast event (inspection in tests and workers).
   */
  get event(): any {
    return this._event;
  }

  /**
   * The manager that will deliver it.
   */
  get manager(): BroadcastManager {
    return this._manager;
  }

  /**
   * Deliver the event now: normalise it, then broadcast through the
   * connection the event asked for.
   * Laravel: BroadcastEvent::handle(BroadcastingFactory $manager)
   */
  async handle(): Promise<void> {
    const { channels, event, payload } = normalizeBroadcastEvent(this._event);

    if (channels.length === 0) {
      return;
    }

    const connection =
      typeof this._event?.broadcastConnection === 'function' ? this._event.broadcastConnection() : undefined;

    await this._manager.driver(connection).broadcast(channels, event, payload);
  }

  /**
   * The display name mirrors Laravel's, reporting the wrapped event's class.
   */
  displayName(): string {
    return this._event?.constructor?.name ?? 'BroadcastEvent';
  }
}
