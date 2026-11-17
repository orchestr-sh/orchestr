/**
 * Notifications Module
 *
 * Laravel-compatible notifications: a Notification base class describing
 * what goes where, a Notifiable concern for Ensemble models (notify,
 * notifyNow, routeNotificationFor, notifications()), a NotificationSender
 * that resolves channels and routes delivery, channels for mail (delegated
 * to the mail subsystem), database (rows in the notifications table, read
 * through a DatabaseNotification model) and broadcast (delegated to a
 * broadcasting layer when one is registered), on-demand routing without a
 * persisted notifiable, queued delivery through the queue subsystem, and
 * NotificationSent / NotificationFailed events.
 */

// Core
export { Notification } from './Notification';
export { Notifiable, resolveNotificationRouter } from './Notifiable';
export type { NotifiableContract, NotifiableConstructor, NotifiableInstance } from './Notifiable';
export { NotificationSender, NOTIFICATIONS_DEFAULTS } from './NotificationSender';
export type { NotificationsConfig, EventDispatcherLike, NotificationQueueDispatcherLike } from './NotificationSender';
export { PendingNotification } from './PendingNotification';
export { AnonymousNotifiable } from './AnonymousNotifiable';
export { SendQueuedNotification } from './SendQueuedNotification';

// Database storage
export { DatabaseNotification } from './DatabaseNotification';

// Channels
export { MailChannel } from './Channels/MailChannel';
export type { MailChannelOptions, NotificationMailerLike } from './Channels/MailChannel';
export { DatabaseChannel } from './Channels/DatabaseChannel';
export { BroadcastChannel } from './Channels/BroadcastChannel';
export type { BroadcastDriverLike, BroadcastNotificationLike } from './Channels/BroadcastChannel';

// Events
export { NotificationSent } from './Events/NotificationSent';
export { NotificationFailed } from './Events/NotificationFailed';

// Contracts
export type { Channel, ChannelFactory } from './Contracts/Channel';
export type { NotificationRouterLike } from './Contracts/NotificationRouter';

// Provider
export { NotificationServiceProvider } from './NotificationServiceProvider';
