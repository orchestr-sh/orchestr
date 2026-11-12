/**
 * Events Module
 *
 * Provides event dispatching and listener management following Laravel's event system
 */

// Core Event Classes
export { Event } from './Event';
export type { EventClass } from './Event';
export { Dispatcher } from './Dispatcher';
export { NullDispatcher } from './NullDispatcher';
export { PendingDispatch } from './PendingDispatch';
export { EventServiceProvider } from './EventServiceProvider';
export { EventDiscoveryCache } from './EventDiscoveryCache';
export type { CachedEventEntry, EventCache } from './EventDiscoveryCache';
export { CallQueuedListener } from './CallQueuedListener';
export { registerListener, resolveRegisteredListener, clearListenerRegistry } from './ListenerRegistry';

// Concerns/Mixins
export { Dispatchable, applyDispatchable } from './Concerns/Dispatchable';

// Contracts
export type { DispatcherContract } from './Contracts/Dispatcher';
export type { ShouldDispatchAfterCommit } from './Contracts/ShouldDispatchAfterCommit';
export { isShouldDispatchAfterCommit } from './Contracts/ShouldDispatchAfterCommit';

// Types
export type {
  EventListener,
  EventNameOrClass,
  EventSubscriber,
  ListenerInterface,
  ListenerClass,
  ListenerClosure,
  EventPayload,
  QueuedListener,
  RegisteredListener,
} from './types';
