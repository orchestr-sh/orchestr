/**
 * The mail channel
 *
 * The channel only asks the notification for its Mailable and hands it to
 * the mail subsystem with the notifiable's mail route (DRY: nothing here
 * builds or renders a message). These tests pin that delegation from both
 * sides - the channel against a recorded mailer surface, and the whole
 * stack through the container's `mailer` binding and the array transport.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RecipientsInput } from '@/Mail/Mailer';
import type { NotificationMailerLike } from '@/Notifications/Channels/MailChannel';
import { Mailable } from '@/Mail/Mailable';
import { MailChannel } from '@/Notifications/Channels/MailChannel';
import { Notification } from '@/Notifications/Notification';
import type { NotificationTestApp } from './support';
import { InvoicePaid, createNotificationApp, recipient } from './support';

/**
 * A Mailable the notification can hand over, carrying a payload the
 * rendered message must preserve.
 */
class ReceiptMail extends Mailable {
  envelope(): void {
    this.subject('Receipt');
  }

  content(): void {
    this.html('<p>Receipt body</p>');
  }
}

class ReceiptPaid extends Notification {
  via(): string[] {
    return ['mail'];
  }

  toMail(): Mailable {
    return new ReceiptMail();
  }
}

/**
 * Mail with an explicit sender of its own - the channel must leave it
 * alone in favour of `notifications.from`.
 */
class BrandedMail extends Mailable {
  constructor() {
    super();
    this.from('billing@vendor.test', 'Vendor Billing');
  }

  envelope(): void {
    this.subject('Branded');
  }

  content(): void {
    this.text('branded');
  }
}

class BrandedPaid extends Notification {
  toMail(): Mailable {
    return new BrandedMail();
  }
}

/**
 * Mail that declares its sender at envelope time - the order a real
 * renderer sees it in.
 */
class EnvelopeBrandedMail extends Mailable {
  envelope(): void {
    this.from('billing@vendor.test', 'Vendor Billing');
    this.subject('Envelope Branded');
  }

  content(): void {
    this.text('envelope branded');
  }
}

class EnvelopeBrandedPaid extends Notification {
  toMail(): Mailable {
    return new EnvelopeBrandedMail();
  }
}

/**
 * Records what the channel hands to the mailer, without any mail config.
 */
interface RecordedSend {
  mailable: unknown;
  recipients: RecipientsInput | undefined;
}

function recordingMailer(): { mailer: NotificationMailerLike; sends: RecordedSend[] } {
  const sends: RecordedSend[] = [];

  return {
    sends,

    mailer: {
      async send(mailable: unknown, recipients?: RecipientsInput): Promise<unknown> {
        sends.push({ mailable, recipients });

        return undefined;
      },
    },
  };
}

describe('MailChannel', () => {
  it('hands the notification Mailable and the mail route to the mailer', async () => {
    const { mailer, sends } = recordingMailer();
    const channel = new MailChannel(() => mailer);

    const mailable = await channel.send(recipient('ada@example.com'), new ReceiptPaid());

    expect(sends).toHaveLength(1);
    expect(sends[0].mailable).toBeInstanceOf(ReceiptMail);
    expect(sends[0].recipients).toBe('ada@example.com');
    expect(mailable).toBe(sends[0].mailable);
  });

  it('complains when the notifiable has no mail route', async () => {
    const { mailer } = recordingMailer();
    const channel = new MailChannel(() => mailer);

    await expect(channel.send(recipient('ada@example.com'), new ReceiptPaid())).resolves.not.toThrow();
    await expect(channel.send({ routeNotificationFor: () => null }, new ReceiptPaid())).rejects.toThrow(
      /No \[mail\] routes configured for \[.*\]\./
    );
  });

  it('complains when the notification has no toMail', async () => {
    const { mailer } = recordingMailer();
    const channel = new MailChannel(() => mailer);

    await expect(channel.send(recipient('ada@example.com'), new Notification())).rejects.toThrow(
      'The [Notification] notification must have a toMail method.'
    );
  });

  it('says what to register when the mail subsystem is missing', async () => {
    const channel = new MailChannel(() => null);

    await expect(channel.send(recipient('ada@example.com'), new ReceiptPaid())).rejects.toThrow(
      'The mail channel requires the mail subsystem. Register the MailServiceProvider first.'
    );
  });

  it('applies notifications.from only to mail that declares no sender', async () => {
    const { mailer, sends } = recordingMailer();
    const channel = new MailChannel(() => mailer, { from: { address: 'app@test.orchestr', name: 'App' } });

    await channel.send(recipient('ada@example.com'), new ReceiptPaid());
    await channel.send(recipient('ada@example.com'), new BrandedPaid());

    expect((sends[0].mailable as Mailable).from()).toEqual({ address: 'app@test.orchestr', name: 'App' });
    expect((sends[1].mailable as Mailable).from()).toEqual({ address: 'billing@vendor.test', name: 'Vendor Billing' });
  });

  it('delivers through a named mailer when the configuration asks for one', async () => {
    const calls: string[] = [];
    const inner: NotificationMailerLike = {
      async send(mailable: unknown, recipients?: RecipientsInput): Promise<unknown> {
        calls.push('ses');

        return { mailable, recipients };
      },
    };

    const manager: NotificationMailerLike = {
      async send(): Promise<unknown> {
        calls.push('default');

        return undefined;
      },

      mailer(name?: string) {
        calls.push(`mailer:${name}`);

        return inner;
      },
    };

    const channel = new MailChannel(() => manager, { mailer: 'ses' });

    await channel.send(recipient('ada@example.com'), new ReceiptPaid());

    expect(calls).toEqual(['mailer:ses', 'ses']);
  });

  it('uses the mailer itself when no name is configured', async () => {
    const calls: string[] = [];
    const manager: NotificationMailerLike = {
      async send(): Promise<unknown> {
        calls.push('default');

        return undefined;
      },

      mailer(name?: string) {
        calls.push(`mailer:${name}`);

        return {
          async send(): Promise<unknown> {
            return undefined;
          },
        };
      },
    };

    await new MailChannel(() => manager).send(recipient('ada@example.com'), new ReceiptPaid());

    expect(calls).toEqual(['default']);
  });
});

describe('MailChannel through the container', () => {
  let test: NotificationTestApp;

  beforeEach(async () => {
    test = await createNotificationApp();
  });

  afterEach(async () => {
    await test.cleanup();
  });

  it('renders the Mailable and records it on the array transport', async () => {
    await test.sender.send(recipient('ada@example.com'), new InvoicePaid({ id: 42, total: '£10' }));

    const messages = test.sentThrough();

    expect(messages).toHaveLength(1);
    expect(messages[0].subject).toBe('Invoice #42 paid');
    expect(messages[0].to[0].address).toBe('ada@example.com');
    expect(messages[0].html).toContain('We received £10');
  });

  it('takes the mail route from a routeNotificationForMail method', async () => {
    const notifiable = {
      routeNotificationForMail(): string {
        return 'method@example.com';
      },

      routeNotificationFor(channel: string): unknown {
        return channel === 'mail' ? this.routeNotificationForMail() : null;
      },
    };

    await test.sender.send(notifiable, new InvoicePaid({ id: 1, total: '£1' }));

    expect(test.sentThrough()[0].to[0].address).toBe('method@example.com');
  });

  it('delivers to several recipients on one send', async () => {
    await test.sender.send(
      [recipient('ada@example.com'), recipient('grace@example.com')],
      new InvoicePaid({ id: 2, total: '£2' })
    );

    expect(test.sentThrough().map((message) => message.to[0].address)).toEqual([
      'ada@example.com',
      'grace@example.com',
    ]);
  });

  it('honours notifications.mail.mailer and notifications.from from config', async () => {
    const named = await createNotificationApp({
      mail: {
        default: 'bulk',
        mailers: { premium: { transport: 'array' }, bulk: { transport: 'array' } },
      },
      notifications: {
        mail: { mailer: 'premium' },
        from: { address: 'notifications@test.orchestr', name: 'Notifications' },
      },
    });

    try {
      await named.sender.sendNow(recipient('ada@example.com'), new ReceiptPaid());

      // Delivered through the named mailer, not the default one.
      expect(named.sentThrough('premium')).toHaveLength(1);
      expect(named.sentThrough('bulk')).toHaveLength(0);

      const [message] = named.sentThrough('premium');

      expect(message.subject).toBe('Receipt');
      expect(message.from[0].address).toBe('notifications@test.orchestr');
    } finally {
      await named.cleanup();
    }
  });

  it('leaves a sender declared by the Mailable itself in charge', async () => {
    const configured = await createNotificationApp({
      notifications: { from: { address: 'app@test.orchestr', name: 'App' } },
    });

    try {
      await configured.sender.sendNow(recipient('ada@example.com'), new EnvelopeBrandedPaid());

      const [message] = configured.sentThrough();

      expect(message.from[0]).toEqual({ address: 'billing@vendor.test', name: 'Vendor Billing' });
    } finally {
      await configured.cleanup();
    }
  });
});
