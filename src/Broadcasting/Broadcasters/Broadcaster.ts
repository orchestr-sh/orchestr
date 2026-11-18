/**
 * Broadcaster - the shared base every driver extends.
 *
 * Holds the one piece every driver needs in common - the channel authorizer -
 * and forwards `auth()` to it, so authorization lives in one place rather
 * than being re-implemented per driver (SRP/OCP). Subclasses supply only the
 * two driver-specific jobs: how a broadcast reaches its service (`broadcast`)
 * and how an authorized subscription is shaped for that driver's clients
 * (`validAuthenticationResponse`).
 *
 * Mirrors Illuminate\Broadcasting\Broadcasters\Broadcaster.
 */

import type { ChannelAuthorization, ChannelAuthorizationCallback } from '@/Broadcasting/ChannelAuthorizer';
import type { Channel } from '@/Broadcasting/Channels';
import type {
  BroadcastAuthRequest,
  BroadcastPayload,
  Broadcaster as BroadcasterContract,
} from '@/Broadcasting/Contracts/Broadcaster';
import { ChannelAuthorizer } from '@/Broadcasting/ChannelAuthorizer';

export abstract class AbstractBroadcaster implements BroadcasterContract {
  constructor(protected authorizer: ChannelAuthorizer = new ChannelAuthorizer()) {}

  /**
   * The shared channel authorizer this driver verifies subscriptions with.
   */
  get channels(): ChannelAuthorizer {
    return this.authorizer;
  }

  /**
   * Register a channel authorization callback.
   * Laravel: Broadcast::channel($pattern, $callback)
   */
  channel(pattern: string, callback: ChannelAuthorizationCallback): this {
    this.authorizer.channel(pattern, callback);

    return this;
  }

  /**
   * Register a presence-channel callback.
   * Laravel: Broadcast::presence($pattern, $callback)
   */
  presence(pattern: string, callback: ChannelAuthorizationCallback): this {
    this.authorizer.presence(pattern, callback);

    return this;
  }

  /**
   * Register a public (guest) channel.
   * Laravel: Broadcast::guest($pattern, $callback = null)
   */
  guest(pattern: string, callback?: ChannelAuthorizationCallback): this {
    this.authorizer.guest(pattern, callback);

    return this;
  }

  /**
   * Authenticate an incoming channel subscription request.
   * Laravel: Broadcaster::auth($request)
   */
  async auth(request: BroadcastAuthRequest): Promise<ChannelAuthorization> {
    return await this.authorizer.authenticate(request);
  }

  /**
   * Default auth response for drivers with no per-client token
   * (log/null); Pusher overrides this with its signed payload.
   * Laravel: Broadcaster::validAuthenticationResponse($request, $result)
   */
  validAuthenticationResponse(_request: BroadcastAuthRequest, _result: any): any {
    return {};
  }

  /**
   * Deliver a normalised broadcast; implemented per driver.
   */
  abstract broadcast(channels: Channel[], event: string, payload?: BroadcastPayload): Promise<void> | void;
}
