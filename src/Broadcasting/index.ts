/**
 * Broadcasting Module
 *
 * A Laravel-shaped broadcasting layer (Illuminate\Broadcasting): a
 * BroadcastManager selects a driver (log / null / pusher), the broadcasters
 * deliver normalised events to their channels, and the ChannelAuthorizer
 * decides who may listen to private/presence channels - each concern kept
 * separate (SRP) and every driver sharing one event/payload normalisation
 * path (DRY).
 *
 * The entry points:
 * - the `Broadcast` facade and `broadcast()` helper,
 * - the `BroadcastServiceProvider` that binds the manager,
 * - the `ShouldBroadcast`/`ShouldBroadcastNow` event contracts the event
 *   dispatcher routes broadcasts through,
 * - the `BroadcastController`/`registerBroadcastRoutes` auth endpoint.
 */

// Manager + configuration
export { BroadcastManager, BROADCASTING_DEFAULTS } from './BroadcastManager';
export type {
  BroadcastConfig,
  BroadcastConnectionConfig,
  BroadcastDriverFactory,
  BroadcastQueueLike,
} from './BroadcastManager';

// Providers
export { BroadcastServiceProvider } from './BroadcastServiceProvider';

// Queued broadcast job
export { BroadcastEvent } from './BroadcastEvent';

// Channels
export {
  Channel,
  PrivateChannel,
  PresenceChannel,
  AnonymousChannel,
  toChannels,
  formatChannels,
  channelPrefix,
  normalizeChannelName,
} from './Channels';
export type { ChannelLike } from './Channels';

// Channel authorization
export { ChannelAuthorizer } from './ChannelAuthorizer';
export type { ChannelAuthorizationCallback, ChannelAuthorization } from './ChannelAuthorizer';

// Contracts
export type { Broadcaster, BroadcastPayload, BroadcastAuthRequest } from './Contracts/Broadcaster';
export type { ShouldBroadcast, ShouldBroadcastNow } from './Contracts/ShouldBroadcast';
export { isShouldBroadcast, isShouldBroadcastNow } from './Contracts/ShouldBroadcast';

// Normalisation
export {
  normalizeBroadcastEvent,
  broadcastEventName,
  broadcastPayload,
  broadcastChannels,
} from './Concerns/NormalizesBroadcastEvent';
export type { NormalizedBroadcast } from './Concerns/NormalizesBroadcastEvent';

// Broadcasters (drivers)
export { AbstractBroadcaster } from './Broadcasters/Broadcaster';
export { LogBroadcaster } from './Broadcasters/LogBroadcaster';
export type { LoggedBroadcast, BroadcastLogger, LogBroadcasterOptions } from './Broadcasters/LogBroadcaster';
export { NullBroadcaster } from './Broadcasters/NullBroadcaster';
export { PusherBroadcaster } from './Broadcasters/PusherBroadcaster';
export type { PusherBroadcasterConfig, PusherHttpLike, PusherResponseLike } from './Broadcasters/PusherBroadcaster';

// Errors
export { BroadcastException } from './BroadcastException';

// Auth endpoint + routes
export { BroadcastController, resolveBroadcastManager } from './BroadcastController';
export { registerBroadcastRoutes } from './routes';
export type { BroadcastRouteOptions } from './routes';

// Testing
export { BroadcastFake } from '@/Support/Testing/Fakes/BroadcastFake';
export type { RecordedBroadcast } from '@/Support/Testing/Fakes/BroadcastFake';
