/**
 * Broadcaster Contract
 *
 * The seam between the broadcasting manager (which selects a driver) and the
 * driver itself (which delivers). Mirrors
 * Illuminate\Contracts\Broadcasting\Broadcaster: a broadcaster authenticates
 * an incoming channel-authorization request, shapes the driver-specific auth
 * response, and broadcasts a normalised event/payload to a set of channels.
 *
 * The event/payload/channels reaching `broadcast` are already normalised by
 * the manager, so a driver only ever formats its own wire representation
 * (OCP: new drivers plug in without touching the normalisation path).
 */

import type { Channel } from '@/Broadcasting/Channels';

/**
 * The normalised payload handed to every driver by the shared
 * event/payload pipeline.
 */
export interface BroadcastPayload {
  [key: string]: any;
}

/**
 * A channel-authorization request, normalised away from any specific HTTP
 * server: a channel name, the connecting socket, and the authenticated user
 * (null for guests / public channels).
 */
export interface BroadcastAuthRequest {
  /** The channel name being subscribed to, including its auth prefix */
  channelName: string;

  /** The connecting client's socket id, when the driver needs one */
  socketId?: string | null;

  /** The authenticated user, or null for a guest */
  user?: any;
}

export interface Broadcaster {
  /**
   * Authenticate the incoming request for the channel it names.
   *
   * Returns the value the channel's authorization callback produced (truthy
   * grants access), and throws `AuthorizationException` when the channel is
   * guarded and the request is not allowed.
   *
   * Laravel: Broadcaster::auth($request)
   */
  auth(request: BroadcastAuthRequest): Promise<any>;

  /**
   * Build the driver's authentication response for a verified request. The
   * shape is driver-specific (a Pusher `auth` string, a Reverb token, ...);
   * log/null drivers answer with an empty object.
   *
   * Laravel: Broadcaster::validAuthenticationResponse($request, $result)
   */
  validAuthenticationResponse(request: BroadcastAuthRequest, result: any): any;

  /**
   * Broadcast a normalised event to the given channels.
   *
   * Laravel: Broadcaster::broadcast(array $channels, $event, array $payload)
   */
  broadcast(channels: Channel[], event: string, payload?: BroadcastPayload): Promise<void> | void;
}
