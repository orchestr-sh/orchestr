/**
 * BroadcastManager - owns broadcasting configuration and builds broadcasters.
 *
 * The same manager pattern as Mail/Queue/Cache: a default connection plus any
 * number of named ones, each assembled from its `broadcasting.connections.*`
 * entry through a registered driver factory. The manager selects drivers and
 * delivers the normalisation + channel-authorization plumbing they share;
 * broadcasters only format their own wire payload (SRP), and the manager never
 * hard-depends on the queue or HTTP subsystems - it resolves them lazily
 * through the container, exactly like the notification sender (OCP).
 *
 * Mirrors Illuminate\Broadcasting\BroadcastManager.
 *
 * @example
 * ```typescript
 * const manager = new BroadcastManager({ default: 'log', connections: { log: { driver: 'log' } } });
 *
 * manager.channel('orders.{id}', (user, id) => user.orders.includes(id));
 * await manager.broadcast(new PrivateChannel('orders.1'), 'OrderShipped', { id: 1 });
 * ```
 */

import type { PusherHttpLike } from '@/Broadcasting/Broadcasters/PusherBroadcaster';
import type { PusherBroadcasterConfig } from '@/Broadcasting/Broadcasters/PusherBroadcaster';
import type { ChannelAuthorizationCallback } from '@/Broadcasting/ChannelAuthorizer';
import type { ChannelLike } from '@/Broadcasting/Channels';
import type { BroadcastAuthRequest, BroadcastPayload, Broadcaster } from '@/Broadcasting/Contracts/Broadcaster';
import type { Container } from '@/Container/Container';
import type { Job } from '@/Queue/Job';
import { LogBroadcaster } from '@/Broadcasting/Broadcasters/LogBroadcaster';
import { NullBroadcaster } from '@/Broadcasting/Broadcasters/NullBroadcaster';
import { PusherBroadcaster } from '@/Broadcasting/Broadcasters/PusherBroadcaster';
import { BroadcastEvent } from '@/Broadcasting/BroadcastEvent';
import { ChannelAuthorizer } from '@/Broadcasting/ChannelAuthorizer';
import { toChannels } from '@/Broadcasting/Channels';
import { normalizeBroadcastEvent } from '@/Broadcasting/Concerns/NormalizesBroadcastEvent';
import { isShouldBroadcast, isShouldBroadcastNow } from '@/Broadcasting/Contracts/ShouldBroadcast';
import { defaultFactory } from '@/Http/Client/Factory';

/**
 * A connection definition; `driver` selects the factory, the rest is
 * driver-specific configuration.
 */
export interface BroadcastConnectionConfig {
  driver: string;
  [key: string]: any;
}

export interface BroadcastConfig {
  /** Default connection name */
  default: string;

  /** Connection definitions keyed by name */
  connections: Record<string, BroadcastConnectionConfig>;
}

/**
 * Structural view of the queue manager needed for queued broadcasts, duck-
 * typed against the container's `queue` binding (the mail/notification seam).
 * `push` routes through the job's own `connection`, so one method covers both.
 */
export interface BroadcastQueueLike {
  push(job: Job, queue?: string): Promise<string>;
}

/**
 * The structural contract a queue dispatcher must satisfy; kept local so the
 * broadcasting layer depends on a contract, not on the Queue module.
 */
export type BroadcastDriverFactory = (config: BroadcastConnectionConfig, authorizer: ChannelAuthorizer) => Broadcaster;

/**
 * Default configuration merged under whatever the app provides, mirroring
 * Laravel's config/broadcasting.php connection table. The default is `log`:
 * visible in development, and never silently delivers a broadcast somewhere
 * unexpected.
 */
export const BROADCASTING_DEFAULTS: BroadcastConfig = {
  default: 'log',
  connections: {
    log: { driver: 'log' },
    null: { driver: 'null' },
    pusher: { driver: 'pusher', key: undefined, secret: undefined, app_id: undefined },
  },
};

export class BroadcastManager {
  public readonly config: BroadcastConfig;

  /**
   * Lazily built broadcasters, keyed by connection name
   */
  protected broadcasters: Map<string, Broadcaster> = new Map();

  /**
   * Registered driver factories
   */
  protected drivers: Map<string, BroadcastDriverFactory> = new Map();

  /**
   * The single channel-authorization registry shared by every broadcaster this
   * manager builds, so `Broadcast.channel(...)` is honoured on any connection
   * (DRY: one authorization path).
   */
  protected authorizer: ChannelAuthorizer = new ChannelAuthorizer();

  constructor(
    config: Partial<BroadcastConfig> = {},
    protected container?: Container
  ) {
    this.config = {
      default: config.default ?? BROADCASTING_DEFAULTS.default,
      connections: { ...BROADCASTING_DEFAULTS.connections, ...(config.connections ?? {}) },
    };

    // Built-in drivers, in the order Laravel's connection table lists them.
    // Like Mail's transports they belong to the manager; the service provider
    // only supplies configuration. Every broadcaster shares this manager's
    // channel authorizer, so one `Broadcast.channel(...)` set governs them all.
    this.registerDriver('log', (_config, authorizer) => new LogBroadcaster({ authorizer }));

    this.registerDriver('null', (_config, authorizer) => new NullBroadcaster(authorizer));

    // Pusher needs the HTTP client: resolved lazily through the container so
    // registration order and test doubles never matter.
    this.registerDriver('pusher', (config: BroadcastConnectionConfig, authorizer) => {
      const { key, secret, app_id, ...rest } = config;

      return new PusherBroadcaster(
        this.resolveHttpClient(),
        {
          key,
          secret,
          appId: app_id,
          ...rest,
        } as PusherBroadcasterConfig,
        authorizer
      );
    });
  }

  // ==================== Driver registry ====================

  /**
   * Register a broadcaster factory under a driver name.
   * Laravel: BroadcastManager::extend()
   */
  registerDriver(name: string, factory: BroadcastDriverFactory): void {
    this.drivers.set(name, factory);

    // Replace any broadcaster already built from the previous definition.
    for (const [connection] of this.broadcasters) {
      if (this.config.connections[connection]?.driver === name) {
        this.broadcasters.delete(connection);
      }
    }
  }

  /**
   * Alias of registerDriver, mirroring the Cache/Mail managers.
   * Laravel: Manager::extend()
   */
  extend(name: string, factory: BroadcastDriverFactory): this {
    this.registerDriver(name, factory);

    return this;
  }

  /**
   * Resolve a broadcaster by connection, defaulting to `broadcasting.default`.
   * Laravel: BroadcastManager::connection()
   */
  connection(name?: string): Broadcaster {
    const connectionName = name ?? this.config.default;

    const cached = this.broadcasters.get(connectionName);

    if (cached) {
      return cached;
    }

    const broadcaster = this.createBroadcaster(connectionName);
    this.broadcasters.set(connectionName, broadcaster);

    return broadcaster;
  }

  /**
   * Alias of connection(), matching Laravel's `driver()` naming.
   * Laravel: BroadcastManager::driver()
   */
  driver(name?: string): Broadcaster {
    return this.connection(name);
  }

  /**
   * The default connection name.
   * Laravel: BroadcastManager::getDefaultDriver()
   */
  getDefaultDriver(): string {
    return this.config.default;
  }

  /**
   * Set the default connection name.
   */
  setDefaultDriver(name: string): void {
    this.config.default = name;
  }

  /**
   * All configured connection names.
   */
  getConnections(): string[] {
    return Object.keys(this.config.connections);
  }

  /**
   * Forget a built broadcaster (the next call rebuilds it).
   * Laravel: BroadcastManager::purge()
   */
  disconnect(name?: string): void {
    this.broadcasters.delete(name ?? this.config.default);
  }

  // ==================== Channel authorization ====================

  /**
   * The shared channel authorizer, for direct inspection/tests.
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
   * Register a presence-channel authorization callback.
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
   * Authenticate a channel-authorization request: verify access through the
   * shared authorizer (which denies guarded channels without a user and
   * callbacks that refuse) and return the active driver's auth response.
   * Laravel: Broadcast::auth($request)
   */
  async auth(request: BroadcastAuthRequest): Promise<any> {
    const authorization = await this.authorizer.authenticate(request);

    return await this.connection().validAuthenticationResponse(request, authorization.result);
  }

  /**
   * Build the active driver's auth response for an already-authorized request.
   * Laravel: Broadcast::validAuthenticationResponse($request, $result)
   */
  validAuthenticationResponse(request: BroadcastAuthRequest, result: any): any {
    return this.connection().validAuthenticationResponse(request, result);
  }

  // ==================== Broadcasting ====================

  /**
   * Broadcast a normalised event to the given channels through the connection.
   * Channels accept strings or `Channel` instances and are normalised here so
   * every driver sees the same shape (DRY).
   * Laravel: BroadcastManager::broadcast()
   */
  async broadcast(
    channels: ChannelLike | ChannelLike[],
    event: string,
    payload: BroadcastPayload = {},
    connection?: string
  ): Promise<void> {
    await this.connection(connection).broadcast(toChannels(channels), event, payload);
  }

  /**
   * Broadcast a `ShouldBroadcast`-style event synchronously, normalising its
   * channels/name/payload first.
   * Laravel: Broadcast::event($event) (the synchronous path)
   */
  async broadcastEvent(event: any, connection?: string): Promise<void> {
    const normalized = normalizeBroadcastEvent(event);

    if (normalized.channels.length === 0) {
      return;
    }

    await this.connection(connection ?? connectionOf(event) ?? undefined).broadcast(
      normalized.channels,
      normalized.event,
      normalized.payload
    );
  }

  /**
   * Deliver a broadcastable event, honouring its queue/connection markers and
   * `broadcastWhen()`: `ShouldBroadcastNow` broadcasts inline, anything else is
   * pushed through the queue subsystem as a BroadcastEvent job (falling back to
   * a synchronous broadcast when no queue is registered).
   *
   * Laravel: BroadcastManager::queue($event)
   */
  async queue(event: any): Promise<void> {
    if (!isShouldBroadcast(event)) {
      return;
    }

    if (typeof event.broadcastWhen === 'function') {
      const allowed = await event.broadcastWhen();

      if (!allowed) {
        return;
      }
    }

    if (normalizeBroadcastEvent(event).channels.length === 0) {
      return;
    }

    if (isShouldBroadcastNow(event)) {
      await this.broadcastEvent(event);

      return;
    }

    await this.pushBroadcastJob(event);
  }

  // ==================== Internals ====================

  /**
   * Push a BroadcastEvent job onto the queue, respecting the event's
   * connection/queue markers (and after-commit, which the queue manager
   * handles via the job's `afterCommit` flag). Falls back to a synchronous
   * broadcast when the queue subsystem is not registered, so a broadcast never
   * silently vanishes.
   */
  protected async pushBroadcastJob(event: any): Promise<void> {
    const manager = this.resolveQueue();

    if (!manager) {
      await this.broadcastEvent(event);

      return;
    }

    const job = new BroadcastEvent(this, event);

    job.connection = connectionOf(event) ?? undefined;
    job.queue = typeof event.broadcastQueue === 'function' ? (event.broadcastQueue() ?? undefined) : undefined;
    job.afterCommit = event.afterCommit === true;

    await manager.push(job, job.queue);
  }

  /**
   * Build a broadcaster from its `broadcasting.connections.*` entry.
   */
  protected createBroadcaster(name: string): Broadcaster {
    const config = this.config.connections[name];

    if (!config) {
      throw new Error(`Broadcast connection [${name}] is not defined.`);
    }

    const factory = this.drivers.get(config.driver);

    if (!factory) {
      throw new Error(
        `Broadcast driver [${config.driver}] is not supported. Available drivers: ${Array.from(this.drivers.keys()).join(', ')}`
      );
    }

    const broadcaster = factory(config, this.authorizer);

    return broadcaster;
  }

  /**
   * The queue manager, or null when queueing is not wired up.
   */
  protected resolveQueue(): BroadcastQueueLike | null {
    return this.resolveService<BroadcastQueueLike>('queue');
  }

  /**
   * The HTTP client for the pusher driver: the container's `http` binding when
   * present, otherwise the process-wide default factory.
   */
  protected resolveHttpClient(): PusherHttpLike {
    return this.resolveService<PusherHttpLike>('http') ?? defaultFactory();
  }

  /**
   * Read a service from the container without depending on when - or whether -
   * the owning provider registered it.
   */
  protected resolveService<T>(binding: string): T | null {
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
 * The queue connection an event asked its broadcast to use, via either a
 * `broadcastConnection()` method or the shared `connection` property.
 */
function connectionOf(event: any): string | null {
  if (typeof event?.broadcastConnection === 'function') {
    return event.broadcastConnection() ?? null;
  }

  return event?.connection ?? null;
}
