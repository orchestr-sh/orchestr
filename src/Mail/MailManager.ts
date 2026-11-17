/**
 * MailManager - owns mail configuration and builds mailers from it.
 *
 * Mirrors Laravel's Illuminate\Mail\MailManager (over the same Manager
 * pattern as QueueManager/FilesystemManager): a default mailer plus any
 * number of named ones, each assembled from its `mail.mailers.*` entry
 * through a registered transport factory. Callers keep talking to the
 * manager - `mail()->to(...)->send(...)` resolves the default mailer
 * behind it - so switching transports is a config change, not a code
 * change.
 *
 * @example
 * ```typescript
 * const manager = new MailManager({ default: 'array', mailers: { array: { transport: 'array' } } });
 *
 * await manager.send(new WelcomeMail(user)); // through the array mailer
 * ```
 */

import type { Container } from '@/Container/Container';
import type { Disk } from '@/Filesystem/Contracts/Disk';
import type { FilesystemManager } from '@/Filesystem/FilesystemManager';
import type { QueueDispatcherLike } from '@/Mail/Contracts/QueueDispatcher';
import type { MailerConfig, Transport } from '@/Mail/Contracts/Transport';
import type { RecipientsInput } from '@/Mail/Mailer';
import type { AddressLike, MailAddress } from '@/Mail/MailMessage';
import type { MailableLike } from '@/Mail/MessageRenderer';
import type { PendingMail } from '@/Mail/PendingMail';
import type { ViewFactory } from '@/View/ViewFactory';
import { Mailer } from '@/Mail/Mailer';
import { normalizeAddress } from '@/Mail/MailMessage';
import { MessageRenderer } from '@/Mail/MessageRenderer';
import { ArrayTransport } from '@/Mail/Transports/ArrayTransport';
import { FailoverTransport } from '@/Mail/Transports/FailoverTransport';
import { LogTransport } from '@/Mail/Transports/LogTransport';
import { SmtpTransport } from '@/Mail/Transports/SmtpTransport';

/**
 * A transport driver factory, as registered with
 * `registerTransport()` / `extend()`.
 */
export type TransportFactory = (config: MailerConfig, name: string) => Transport;

export interface MailFromConfig {
  address: string;
  name?: string;
}

export interface MailConfig {
  /** Default mailer name */
  default: string;

  /** The application's "from" address */
  from: MailFromConfig;

  /** Mailer definitions keyed by mailer name */
  mailers: Record<string, MailerConfig>;

  /** Where `attachFromStorage()` reads from by default */
  attachments?: { disk?: string };
}

/**
 * Default configuration merged under whatever the app provides,
 * mirroring Laravel's config/mail.php mailer table. The default mailer
 * is `log`: visible in development, and never silently swallows or
 * externally delivers a message.
 */
export const MAIL_DEFAULTS: MailConfig = {
  default: 'log',
  from: { address: 'hello@orchestr.test', name: 'Orchestr' },
  mailers: {
    smtp: { transport: 'smtp', host: 'localhost', port: 25 },
    log: { transport: 'log' },
    array: { transport: 'array' },
    failover: { transport: 'failover', mailers: ['smtp', 'log'] },
  },
};

export class MailManager {
  public readonly config: MailConfig;

  /**
   * Lazily built mailers, keyed by mailer name
   */
  protected mailers: Map<string, Mailer> = new Map();

  /**
   * Registered transport factories
   */
  protected transports: Map<string, TransportFactory> = new Map();

  constructor(
    config: Partial<MailConfig> = {},
    protected container?: Container
  ) {
    this.config = {
      default: config.default ?? MAIL_DEFAULTS.default,
      from: { ...MAIL_DEFAULTS.from, ...(config.from ?? {}) },
      mailers: { ...MAIL_DEFAULTS.mailers, ...(config.mailers ?? {}) },
      attachments: config.attachments,
    };

    // Built-in transports, in the order Laravel's mailers table lists
    // them. Like FilesystemManager's drivers, they belong to the
    // manager; the service provider only supplies configuration.
    this.registerTransport('log', (config: MailerConfig) => new LogTransport({ path: config.path }));

    this.registerTransport('array', () => new ArrayTransport());

    // nodemailer is an optional peer dependency; the transport only
    // imports (and therefore only requires) it when an SMTP mailer is
    // actually used. `client` is the injection seam for custom
    // connections and tests.
    this.registerTransport('smtp', (config: MailerConfig) => new SmtpTransport(config, config.client));

    // Failover assembles its siblings from the mailer names in its
    // config through this same manager.
    this.registerTransport('failover', (config: MailerConfig) => {
      const names: string[] = Array.isArray(config.mailers) ? config.mailers : [];

      return new FailoverTransport(names.map((name) => this.transport(name)));
    });
  }

  /**
   * Register a transport factory under a driver name.
   * Laravel: MailManager::extend() (via the TransportManager)
   */
  registerTransport(name: string, factory: TransportFactory): void {
    this.transports.set(name, factory);

    // Replace any mailer already built from the previous definition.
    for (const [mailerName, mailer] of this.mailers) {
      if ((this.config.mailers[mailerName]?.transport ?? this.config.mailers[mailerName]?.driver) === name) {
        this.mailers.delete(mailerName);
      }
    }
  }

  /**
   * Alias of registerTransport, mirroring Cache/Filesystem managers.
   * Laravel: Manager::extend()
   */
  extend(name: string, factory: TransportFactory): this {
    this.registerTransport(name, factory);

    return this;
  }

  /**
   * Resolve a mailer by name, defaulting to `mail.default`.
   * Laravel: MailManager::mailer()
   */
  mailer(name?: string): Mailer {
    const mailerName = name ?? this.config.default;

    const cached = this.mailers.get(mailerName);

    if (cached) {
      return cached;
    }

    const mailer = this.createMailer(mailerName);
    this.mailers.set(mailerName, mailer);

    return mailer;
  }

  /**
   * The transport behind a mailer - Laravel: MailManager::transport().
   */
  transport(name?: string): Transport {
    return this.mailer(name).getTransport();
  }

  /**
   * The default mailer name.
   * Laravel: MailManager::getDefaultDriver()
   */
  getDefaultMailer(): string {
    return this.config.default;
  }

  /**
   * Set the default mailer name.
   */
  setDefaultMailer(name: string): void {
    this.config.default = name;
  }

  /**
   * All configured mailer names.
   */
  getMailers(): string[] {
    return Object.keys(this.config.mailers);
  }

  /**
   * Forget a built mailer (its transport stays as the driver left it).
   */
  disconnect(name?: string): void {
    this.mailers.delete(name ?? this.config.default);
  }

  // ==================== Default-mailer delegation ====================
  // Laravel's MailManager forwards every mailer method to the default
  // mailer through __call; the same surface is spelled out here.

  /**
   * Begin a send to the given recipients using the default mailer.
   * Laravel: Mail::to()
   */
  to(...recipients: Array<AddressLike | AddressLike[]>): PendingMail {
    return this.mailer().to(...recipients);
  }

  /**
   * Send a mailable through the default mailer.
   * Laravel: Mail::send()
   */
  send(mailable: MailableLike, recipients?: RecipientsInput): Promise<void> {
    return this.mailer().send(mailable, recipients);
  }

  /**
   * Queue a mailable on the default mailer.
   * Laravel: Mail::queue()
   */
  queue(mailable: MailableLike, recipients?: RecipientsInput): Promise<string> {
    return this.mailer().queue(mailable, recipients);
  }

  /**
   * Queue a mailable with a delay on the default mailer.
   * Laravel: Mail::later()
   */
  later(delay: number | Date, mailable: MailableLike, recipients?: RecipientsInput): Promise<string> {
    return this.mailer().later(delay, mailable, recipients);
  }

  /**
   * Send a raw message through the default mailer.
   * Laravel: Mail::raw()
   */
  raw(subject: string, html?: string | ((message: any) => any), callback?: (message: any) => any): Promise<void> {
    return this.mailer().raw(subject, html, callback);
  }

  /**
   * Send raw HTML through the default mailer.
   * Laravel: Mail::html()
   */
  html(html: string, callback?: (message: any) => any): Promise<void> {
    return this.mailer().html(html, callback);
  }

  /**
   * Send raw text through the default mailer.
   * Laravel: Mail::text()
   */
  text(text: string, callback?: (message: any) => any): Promise<void> {
    return this.mailer().text(text, callback);
  }

  // ==================== Internals ====================

  /**
   * Build a mailer from its `mail.mailers.*` entry.
   */
  protected createMailer(name: string): Mailer {
    const config = this.config.mailers[name];

    if (!config) {
      throw new Error(`Mail mailer [${name}] not configured.`);
    }

    const transportName = config.transport ?? config.driver ?? name;

    const factory = this.transports.get(transportName);

    if (!factory) {
      throw new Error(
        `Mail transport [${transportName}] not registered. Available transports: ${Array.from(this.transports.keys()).join(', ')}`
      );
    }

    const transport = factory(config, name);

    return new Mailer(transport, this.createRenderer(), {
      name,
      from: this.defaultFrom(),
      queue: () => this.resolveQueue(),
    });
  }

  /**
   * The configured sender, when `mail.from` carries an address.
   */
  protected defaultFrom(): MailAddress | undefined {
    return this.config.from?.address ? normalizeAddress(this.config.from) : undefined;
  }

  /**
   * One renderer configuration for every mailer this manager builds;
   * its dependencies (views, disks, default from) are resolved lazily so
   * registration order does not matter (DRY: one renderer path).
   */
  protected createRenderer(): MessageRenderer {
    return new MessageRenderer({
      views: () => this.resolveViews(),
      disks: (disk?: string) => this.resolveDisk(disk),
      from: this.defaultFrom(),
      attachmentDisk: this.config.attachments?.disk,
    });
  }

  /**
   * The registered view factory, or null when no view layer exists.
   */
  protected resolveViews(): ViewFactory | null {
    return this.resolveService<ViewFactory>('view');
  }

  /**
   * A storage disk for attachment reads, or null when the filesystem
   * layer is not registered.
   */
  protected resolveDisk(disk?: string): Disk | null {
    const manager = this.resolveService<FilesystemManager>('filesystem');

    if (!manager) {
      return null;
    }

    return manager.disk(disk);
  }

  /**
   * The queue manager for `queue()`/`later()` delivery, or null.
   */
  protected resolveQueue(): QueueDispatcherLike | null {
    return this.resolveService<QueueDispatcherLike>('queue');
  }

  /**
   * Read a service from the container without making the mail subsystem
   * depend on when - or whether - the owning provider registered it.
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
