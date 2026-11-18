/**
 * NullBroadcaster - accepts broadcasts and discards them.
 *
 * Laravel's `null` broadcast driver: the "wired up but going nowhere" sink for
 * environments where broadcasting is switched off without removing the code
 * that calls it. `broadcast` resolves immediately and records nothing.
 *
 * Mirrors Illuminate\Broadcasting\Broadcasters\NullBroadcaster.
 */

import type { ChannelAuthorizer } from '@/Broadcasting/ChannelAuthorizer';
import type { Channel } from '@/Broadcasting/Channels';
import type { BroadcastPayload } from '@/Broadcasting/Contracts/Broadcaster';
import { AbstractBroadcaster } from '@/Broadcasting/Broadcasters/Broadcaster';

export class NullBroadcaster extends AbstractBroadcaster {
  constructor(authorizer?: ChannelAuthorizer) {
    super(authorizer);
  }

  /**
   * Discard the broadcast.
   */
  broadcast(_channels: Channel[], _event: string, _payload: BroadcastPayload = {}): void {
    // Intentionally empty: the null driver never delivers.
  }
}
