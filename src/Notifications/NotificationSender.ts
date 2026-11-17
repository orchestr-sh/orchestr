/**
 * NotificationSender - resolves channels and delivers notifications
 *
 * Mirrors Laravel's Illuminate\Notifications\ChannelManager plus the
 * delivery half of Illuminate\Notifications\NotificationSender: it owns
 * the channel registry (mail, database, broadcast out of the box, custom
 * ones through `extend()`), decides *which* channels a send uses
 * (explicit channels, then the notification's `via()`), hands each
 * recipient to the channel behind the `Channel` contract, and fires
 * NotificationSent / NotificationFailed through the event dispatcher.
 *
 * SRP: the Notification describes, this class routes, the channels
 * deliver. Queueable notifications are routed to a worker through the
 * queue subsystem (lazily resolved through the container, the same
 * structural seam Mail uses for queued delivery) instead of being
 * delivered inline - `sendNow` bypasses that, `queue` forces it.
 *
 * @example
 * ```typescript
 * const sender = app.make<NotificationSender>('notifications');
 *
 * await sender.send(user, new InvoicePaid(invoice));                    // via(), queue-aware
 * await sender.sendNow(users, new InvoicePaid(invoice), ['mail']);      // synchronous, many recipients
 * await sender.route('mail', 'guest@example.com').notify(new InvoicePaid(invoice));
 * ```
 */

import type { Container } from '@/Container/Container';
import type { NotificationMailerLike } from '@/Notifications/Channels/MailChannel';
import type { Channel } from '@/Notifications/Contracts/Channel';
import type { NotificationRouterLike } from '@/Notifications/Contracts/NotificationRouter';
import type { Job } from '@/Queue/Job';
import { BroadcastChannel } from '@/Notifications/Channels/BroadcastChannel';
import { DatabaseChannel } from '@/Notifications/Channels/DatabaseChannel';
import { MailChannel } from '@/Notifications/Channels/MailChannel';
import { NotificationFailed } from '@/Notifications/Events/NotificationFailed';
import { NotificationSent } from '@/Notifications/Events/NotificationSent';
import { PendingNotification } from '@/Notifications/PendingNotification';
import { SendQueuedNotification } from '@/Notifications/SendQueuedNotification';

/**
 * The `notifications` configuration section.
 */
export interface NotificationsConfig {
  mail?: {
    /** Named mailer (a `mail.mailers` key) the mail channel delivers through */
    mailer?: string | null;
  };

  from?: {
    /** Default sender for notification mail whose Mailable declares none */
    address?: string | null;

    /** Display name paired with `address` */
    name?: string | null;
  };

  queue?: {
    /** Queue connection queueable notifications dispatch on */
    connection?: string | null;
  };

  /**
   * Registered custom channel implementations or factories keyed by
   * channel name. Laravel: container bindings of channels; here a config
   * seam so providers can contribute channels declaratively.
   */
  channels?: Record<string, Channel | (() => Channel)>;
}

/**
 * Default configuration merged under whatever the app provides, the
 * MailManager pattern applied to notifications: every value null means
 * "defer to the mail and queue subsystems' own defaults".
 */
export const NOTIFICATIONS_DEFAULTS: NotificationsConfig = {
  mail: { mailer: null },
  from: { address: null, name: null },
  queue: { connection: null },
};

/**
 * Structural view of the event dispatcher (a missing or faked dispatcher
 * is fine - the notification layer depends on a contract, not the
 * concrete Dispatcher). Laravel: Illuminate\Contracts\Events\Dispatcher.
 */
export interface EventDispatcherLike {
  dispatch(event: unknown, payload?: any[], halt?: boolean): Promise<unknown> | unknown;
}

/**
 * Structural view of the queue manager needed for queued delivery.
 * Named apart from the mail layer's identical `QueueDispatcherLike` so
 * both stay duck-typed against the container's `queue` binding without
 * colliding in the public exports.
 * Laravel: Illuminate\Contracts\Queue\Factory.
 */
export interface NotificationQueueDispatcherLike {
  dispatch(job: Job): Promise<string>;
}

export class NotificationSender implements NotificationRouterLike {
  public readonly config: NotificationsConfig;

  /**
   * Registered channel drivers, keyed by channel name
   */
  protected channels: Map<string, Channel | (() => Channel)> = new Map();

  /**
   * Factories already resolved into channel instances (cached the way
   * MailManager caches its mailers)
   */
  protected drivers: Map<string, Channel> = new Map();

  constructor(
    config: Partial<NotificationsConfig> = {},
    protected container?: Container
  ) {
    this.config = {
      mail: { ...NOTIFICATIONS_DEFAULTS.mail, ...(config.mail ?? {}) },
      from: { ...NOTIFICATIONS_DEFAULTS.from, ...(config.from ?? {}) },
      queue: { ...NOTIFICATIONS_DEFAULTS.queue, ...(config.queue ?? {}) },
      channels: config.channels,
    };

    // Built-in channels, in the order Laravel registers them. Like the
    // mail transports, they belong to the manager; the service provider
    // only supplies configuration. Dependencies (the mailer, the
    // broadcaster) are resolved lazily through the container so
    // registration order - and test doubles - never matter (DRY).
    this.registerChannel(
      'mail',
      () =>
        new MailChannel(() => this.resolveService<NotificationMailerLike>('mailer'), {
          mailer: this.config.mail?.mailer,
          from: this.config.from?.address
            ? { address: this.config.from.address, name: this.config.from.name }
            : undefined,
        })
    );

    this.registerChannel('database', () => new DatabaseChannel());

    this.registerChannel('broadcast', () => new BroadcastChannel(() => this.resolveService('broadcast')));

    for (const [name, channel] of Object.entries(this.config.channels ?? {})) {
      this.registerChannel(name, channel);
    }
  }

  /**
   * Register a channel implementation (or factory) under a name.
   * Laravel: ChannelManager::extend() / container bindings
   */
  registerChannel(name: string, channel: Channel | (() => Channel)): void {
    this.channels.set(name, channel);

    // Replace any driver already built from the previous definition.
    this.drivers.delete(name);
  }

  /**
   * Alias of registerChannel, mirroring MailManager::extend().
   */
  extend(name: string, channel: Channel | (() => Channel)): this {
    this.registerChannel(name, channel);

    return this;
  }

  /**
   * The resolved Channel implementation for a name.
   * Laravel: ChannelManager::driver()
   */
  channel(name: string): Channel {
    const cached = this.drivers.get(name);

    if (cached) {
      return cached;
    }

    const registration = this.channels.get(name);

    if (!registration) {
      throw new Error(
        `Notification channel [${name}] is not supported. Available channels: ${Array.from(this.channels.keys()).join(', ')}`
      );
    }

    const driver = typeof registration === 'function' ? registration() : registration;

    this.drivers.set(name, driver);

    return driver;
  }

  /**
   * The registered channel names.
   */
  getChannels(): string[] {
    return Array.from(this.channels.keys());
  }

  // ==================== Delivery ====================

  /**
   * Send a notification to one notifiable, a list of them, or a
   * collection of them. Queueable notifications are dispatched to the
   * queue; everything else is delivered inline.
   * Laravel: NotificationSender::send()
   */
  async send(notifiables: unknown, notification: unknown, channels?: string | string[]): Promise<void> {
    if (this.shouldQueue(notification)) {
      await this.queue(notifiables, notification, channels);

      return;
    }

    await this.sendNow(notifiables, notification, channels);
  }

  /**
   * Deliver synchronously, queue markers notwithstanding.
   * Laravel: NotificationSender::sendNow()
   */
  async sendNow(notifiables: unknown, notification: unknown, channels?: string | string[]): Promise<void> {
    for (const notifiable of notifiableList(notifiables)) {
      for (const channel of this.resolveChannels(notifiable, notification, channels)) {
        const driver = this.channel(channel);

        let response: unknown;

        try {
          response = await driver.send(notifiable, notification);
        } catch (error) {
          await this.fireEvent(
            new NotificationFailed(notifiable, notification, channel, {
              error: error instanceof Error ? error.message : String(error),
            })
          );

          throw error;
        }

        await this.fireEvent(new NotificationSent(notifiable, notification, channel, response));
      }
    }
  }

  /**
   * Dispatch delivery through the queue subsystem as a
   * SendQueuedNotification job.
   * Laravel: NotificationSender::queue()
   */
  async queue(notifiables: unknown, notification: unknown, channels?: string | string[]): Promise<string> {
    return this.queueWithDelay(undefined, notifiables, notification, channels);
  }

  /**
   * Queue delivery with a delay (seconds or an absolute Date).
   * Laravel: the `later` variant of queueing.
   */
  async later(
    delay: number | Date,
    notifiables: unknown,
    notification: unknown,
    channels?: string | string[]
  ): Promise<string> {
    return this.queueWithDelay(delay, notifiables, notification, channels);
  }

  /**
   * Start an on-demand notification addressed to the given route.
   * Laravel: ChannelManager::route()
   */
  route(channel: string, route: any): PendingNotification {
    return new PendingNotification(() => this, { [channel]: route });
  }

  /**
   * Start an on-demand notification with several routes already
   * collected: `sender.on({ mail: 'guest@example.com' }).notify($n)`.
   */
  on(routes: Record<string, any>): PendingNotification {
    return new PendingNotification(() => this, routes);
  }

  // ==================== Internals ====================

  protected async queueWithDelay(
    delay: number | Date | undefined,
    notifiables: unknown,
    notification: any,
    channels?: string | string[]
  ): Promise<string> {
    const manager = this.queueManager();

    const job = new SendQueuedNotification(
      this,
      notifiableList(notifiables),
      notification,
      channels === undefined || channels === null ? undefined : normalizeChannels(channels)
    );

    const connection = typeof notification?.viaConnection === 'function' ? notification.viaConnection() : null;

    job.connection = connection ?? this.config.queue?.connection ?? undefined;

    const queue = typeof notification?.viaQueue === 'function' ? notification.viaQueue() : null;

    job.queue = queue ?? undefined;

    if (delay !== undefined) {
      job.delay = delay;
    }

    return manager.dispatch(job);
  }

  /**
   * Queue-awareness of a notification: the `queued = true` runtime
   * marker (Laravel's ShouldQueue marker) or a shouldQueue() hook.
   */
  protected shouldQueue(notification: any): boolean {
    if (!notification) {
      return false;
    }

    if (typeof notification.shouldQueue === 'function') {
      return Boolean(notification.shouldQueue());
    }

    return notification.queued === true;
  }

  /**
   * Which channels a send uses: explicitly requested channels first,
   * then the notification's via(), then the mail default - the same
   * precedence Laravel's NotificationSender applies.
   */
  protected resolveChannels(notifiable: unknown, notification: any, channels?: string | string[]): string[] {
    if (channels !== undefined && channels !== null) {
      return normalizeChannels(channels);
    }

    if (notification && typeof notification.via === 'function') {
      return normalizeChannels(notification.via(notifiable));
    }

    return ['mail'];
  }

  /**
   * Fire a notification event through the event subsystem when one is
   * registered; absence of a dispatcher is not an error.
   */
  protected async fireEvent(event: unknown): Promise<void> {
    const dispatcher = this.resolveService<EventDispatcherLike>('events');

    if (!dispatcher) {
      return;
    }

    await dispatcher.dispatch(event);
  }

  /**
   * The queue manager, failing loudly when queueing is not wired up -
   * the error mirrors Mailer's queued-mail guidance.
   */
  protected queueManager(): NotificationQueueDispatcherLike {
    const manager = this.resolveService<NotificationQueueDispatcherLike>('queue');

    if (!manager) {
      throw new Error(
        'Queueing notifications requires the queue subsystem. Register the QueueServiceProvider first, ' +
          'or send the notification synchronously with sendNow().'
      );
    }

    return manager;
  }

  /**
   * Read a service from the container without making the notification
   * subsystem depend on when - or whether - the owning provider
   * registered it (the MailManager seam).
   */
  protected resolveService<T = any>(binding: string): T | null {
    if (!this.container || !this.container.bound(binding)) {
      return null;
    }

    try {
      return this.container.make<T>(binding);
    } catch {
      return null;
    }
  }
}

/**
 * One notifiable or many - Laravel: Arr::wrap(), extended to collections
 * because Ensemble results are collection-backed.
 */
function notifiableList(notifiables: unknown): unknown[] {
  if (notifiables === undefined || notifiables === null) {
    return [];
  }

  if (Array.isArray(notifiables)) {
    return notifiables;
  }

  const maybeCollection = notifiables as { all?(): unknown[] };

  if (typeof maybeCollection.all === 'function') {
    const items = maybeCollection.all();

    if (Array.isArray(items)) {
      return items;
    }
  }

  return [notifiables];
}

/**
 * Normalise a channel list: one name or many, stringified, deduplicated
 * in order.
 */
function normalizeChannels(channels: string | string[]): string[] {
  const list = (Array.isArray(channels) ? channels : [channels]).map(String);

  return [...new Set(list)];
}
