/**
 * Shared helpers for the Notifications test suites: a booted application
 * with the event, queue, mail and notification providers registered
 * against a throwaway base path, plus an in-memory sqlite database with
 * the `users` and `notifications` tables for the database-channel and
 * notifiable-model tests.
 */

import { mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DrizzleAdapter } from '@/Database/Adapters/DrizzleAdapter';
import { Connection } from '@/Database/Connection';
import { DatabaseManager } from '@/Database/DatabaseManager';
import { DatabaseServiceProvider } from '@/Database/DatabaseServiceProvider';
import { Ensemble } from '@/Database/Ensemble/Ensemble';
import { SchemaBuilder } from '@/Database/Migrations/SchemaBuilder';
import { EventServiceProvider } from '@/Events/EventServiceProvider';
import { Application } from '@/Foundation/Application';
import { Config } from '@/Foundation/Config/Config';
import { ServiceProvider } from '@/Foundation/ServiceProvider';
import { Mailable } from '@/Mail/Mailable';
import { MailManager } from '@/Mail/MailManager';
import { MailServiceProvider } from '@/Mail/MailServiceProvider';
import { ArrayTransport } from '@/Mail/Transports/ArrayTransport';
import { Notifiable } from '@/Notifications/Notifiable';
import { Notification } from '@/Notifications/Notification';
import { NotificationSender } from '@/Notifications/NotificationSender';
import { NotificationServiceProvider } from '@/Notifications/NotificationServiceProvider';
import { QueueServiceProvider } from '@/Queue/QueueServiceProvider';
import { Facade } from '@/Support/Facade';

let counter = 0;

export interface Invoice {
  id: number;
  total: string;
}

/**
 * A paid invoice as a Mailable - the notification's mail representation.
 */
export class InvoicePaidMail extends Mailable {
  constructor(public invoice: Invoice) {
    super();
  }

  envelope(): void {
    this.subject(`Invoice #${this.invoice.id} paid`);
  }

  content(): void {
    this.html(`<p>Thanks! We received ${this.invoice.total}.</p>`);
  }
}

export class User extends Notifiable(Ensemble) {
  static fillable = ['name', 'email'];

  protected table: string = 'users';

  getTable(): string {
    return 'users';
  }
}

/**
 * Mail + database notification, the ticket's `InvoicePaid` shape.
 */
export class InvoicePaid extends Notification {
  constructor(public invoice: Invoice) {
    super();
  }

  via(): string[] {
    return ['mail'];
  }

  toMail(): Mailable {
    return new InvoicePaidMail(this.invoice);
  }

  toDatabase(): Record<string, any> {
    return { subject: `Invoice #${this.invoice.id} paid`, amount: this.invoice.total };
  }
}

/**
 * Only ever stored: mail would have nothing to render.
 */
export class DatabaseOnlyPaid extends Notification {
  constructor(public invoice: Invoice) {
    super();
  }

  via(): string[] {
    return ['database'];
  }

  toDatabase(): Record<string, any> {
    return { subject: `Stored #${this.invoice.id}` };
  }
}

/**
 * Delivered on both channels - used to pin the via() fan-out.
 */
export class MultiChannelPaid extends InvoicePaid {
  via(): string[] {
    return ['mail', 'database'];
  }
}

/**
 * Mail channel in via() but no toMail(): the channel must complain.
 */
export class BrokenPaid extends Notification {}

/**
 * Queueable through the runtime marker, like a queued listener.
 */
export class QueuedInvoicePaid extends InvoicePaid {
  public readonly queued = true;
}

export class HighQueueInvoicePaid extends QueuedInvoicePaid {
  viaQueue(): string {
    return 'high';
  }
}

/**
 * A plain (non-model) notifiable: any object answering routeNotificationFor
 * works, which is what keeps the sender tests free of a database.
 */
export function recipient(email: string): any {
  return {
    email,

    routeNotificationFor(channel: string): unknown {
      return channel === 'mail' ? this.email : null;
    },
  };
}

export interface NotificationTestApp {
  app: Application;
  config: Config;
  /** The booted NotificationSender, resolved from the container. */
  sender: NotificationSender;
  /** The booted MailManager, resolved from the container. */
  mail: MailManager;
  /** Root of the temporary application directory. */
  base: string;
  /** The sqlite connection backing users/notifications (when enabled). */
  db: Connection | null;
  /** Create the users + notifications tables on the shared connection. */
  migrate(): Promise<void>;
  /** Persist a user row and return the model. */
  makeUser(name: string, email: string): Promise<User>;
  /** Messages recorded by the array transport mailer. */
  sentThrough(name?: string): MailMessageRecords;
  /** Raw notifications-table rows. */
  rows(): Promise<Record<string, any>[]>;
  cleanup(): Promise<void>;
}

export type MailMessageRecords = ArrayTransport['messages'];

export interface NotificationTestOptions {
  /** Use an in-memory sqlite database and wire Ensemble to it. */
  database?: boolean;
  /** Values layered over the default `notifications` config section. */
  notifications?: Record<string, any>;
  /** Values layered over the default `mail` config section. */
  mail?: Record<string, any>;
  /** Values layered over the default `queue` config section. */
  queue?: Record<string, any>;
  /** Extra top-level config keys. */
  config?: Record<string, any>;
}

export async function createNotificationApp(options: NotificationTestOptions = {}): Promise<NotificationTestApp> {
  const base = join(tmpdir(), `orchestr-notification-tests-${process.pid}-${Date.now()}-${counter++}`);
  mkdirSync(join(base, 'resources/views'), { recursive: true });

  const config = new Config({
    app: { name: 'Notification Test' },
    queue: { default: 'sync', connections: { sync: { driver: 'sync' } } },
    mail: {
      default: 'array',
      from: { address: 'mail@test.orchestr', name: 'Mail Test' },
      mailers: {
        array: { transport: 'array' },
        log: { transport: 'log' },
      },
    },
    notifications: {},
    ...options.config,
  });

  if (options.notifications) {
    config.set('notifications', { ...options.notifications });
  }

  if (options.mail) {
    const mail = config.get<Record<string, any>>('mail', {});
    config.set('mail', { ...mail, ...options.mail });
  }

  if (options.queue) {
    const queue = config.get<Record<string, any>>('queue', {});
    config.set('queue', { ...queue, ...options.queue });
  }

  const app = new Application(base);
  app.instance('config', config);

  Facade.setFacadeApplication(app);
  Facade.clearResolvedInstances();

  app.register(DatabaseServiceProvider);
  // EventServiceProvider is abstract (apps subclass it), so it is
  // registered the way the Testing TestCase registers it.
  app.register(EventServiceProvider as unknown as new (application: Application) => ServiceProvider);
  app.register(QueueServiceProvider);
  app.register(MailServiceProvider);
  app.register(NotificationServiceProvider);

  await app.boot();

  const sender = app.make<NotificationSender>('notifications');
  const mail = app.make<MailManager>('mailer');

  let db: Connection | null = null;

  if (options.database) {
    // A shared in-memory database for the whole app, wired into Ensemble
    // the way the framework's own sqlite setup works.
    const manager = app.make<DatabaseManager>('db');
    db = manager.connection('sqlite');

    Ensemble.setConnectionResolver(manager);

    await db.getAdapter().connect();

    const schema = new SchemaBuilder(db);

    await schema.create('users', (table) => {
      table.id();
      table.string('name');
      table.string('email');
      table.timestamps();
    });

    await schema.create('notifications', (table) => {
      table.uuid('id').primary();
      table.string('type');
      table.morphs('notifiable');
      table.text('data');
      table.timestamp('read_at').nullable();
      table.timestamps();
    });
  }

  return {
    app,
    config,
    sender,
    mail,
    base,
    db,
    async migrate(): Promise<void> {
      // Tables are created up-front by createNotificationApp({ database: true }).
    },
    async makeUser(name: string, email: string): Promise<User> {
      return (await User.create({ name, email })) as User;
    },
    sentThrough(name = 'array'): MailMessageRecords {
      const transport = mail.transport(name) as ArrayTransport;

      return transport.messages;
    },
    async rows(): Promise<Record<string, any>[]> {
      if (!db) {
        throw new Error('createNotificationApp was built without the database option.');
      }

      return db.table('notifications').orderBy('id', 'asc').get();
    },
    async cleanup(): Promise<void> {
      if (db) {
        try {
          await db.getAdapter().disconnect();
        } catch {
          // Already gone
        }
      }

      Facade.clearResolvedInstances();
      Facade.setFacadeApplication(undefined as unknown as Application);
      rmSync(base, { recursive: true, force: true });
    },
  };
}
