/**
 * Mailer behaviour
 *
 * The Mailer sends; it does not describe (Mailable) and does not own
 * configuration (MailManager). These tests pin the send paths: fluent
 * `to(...).send(...)`, raw messages, recipient merging, and queueing
 * through the sync driver.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { MailMessage } from '@/Mail/MailMessage';
import { Mailable } from '@/Mail/Mailable';
import { Mailer } from '@/Mail/Mailer';
import { MessageRenderer } from '@/Mail/MessageRenderer';
import { ArrayTransport } from '@/Mail/Transports/ArrayTransport';
import type { MailTestApp } from './support';
import { createMailApp } from './support';

class WelcomeMail extends Mailable {
  constructor(public user: { email: string; name: string }) {
    super();
  }

  envelope(): void {
    this.subject('Welcome');
  }

  content(): void {
    this.html(`<p>Hello ${this.user.name}</p>`);
  }
}

describe('Mailer', () => {
  let test: MailTestApp;

  beforeEach(async () => {
    test = await createMailApp();
    test.putView('emails.welcome', '<h1>Welcome {{ user.name }}</h1>');
  });

  afterEach(async () => {
    await test.cleanup();
  });

  describe('send', () => {
    it('delivers a rendered mailable through the transport', async () => {
      await test.manager.send(new WelcomeMail({ email: 'ada@example.com', name: 'Ada' }));

      const [message] = test.sentThrough();

      expect(message.subject).toBe('Welcome');
      expect(message.html).toBe('<p>Hello Ada</p>');
      expect(message.from).toEqual([{ address: 'mail@test.orchestr', name: 'Mail Test' }]);
    });

    it('Mail.to(...).send(...) adds recipients and sends through the configured transport', async () => {
      await test.manager.to('ada@example.com').send(new WelcomeMail({ email: 'unused@example.com', name: 'Ada' }));

      const [message] = test.sentThrough();

      expect(message.to).toEqual([{ address: 'ada@example.com' }]);
    });

    it('merges send-time recipients with mailable addresses without dropping either', async () => {
      class BothMail extends Mailable {
        envelope(): void {
          this.to('built@example.com');
        }

        content(): void {
          this.text('hi');
        }
      }

      await test.manager.send(new BothMail(), ['extra@example.com']);

      const [message] = test.sentThrough();

      expect(message.to.map((address) => address.address)).toEqual(['built@example.com', 'extra@example.com']);
    });

    it('supports cc and bcc through the fluent chain', async () => {
      await test.manager
        .to('ada@example.com')
        .cc('grace@example.com')
        .bcc('secret@example.com')
        .send(new WelcomeMail({ email: 'ada@example.com', name: 'Ada' }));

      const [message] = test.sentThrough();

      expect(message.cc).toEqual([{ address: 'grace@example.com' }]);
      expect(message.bcc).toEqual([{ address: 'secret@example.com' }]);
      expect(message.recipients().map((address) => address.address)).toEqual([
        'ada@example.com',
        'grace@example.com',
        'secret@example.com',
      ]);
    });

    it('accepts an address object with a display name', async () => {
      await test.manager
        .to({ address: 'ada@example.com', name: 'Ada Lovelace' })
        .send(new WelcomeMail({ email: 'a@b.c', name: 'A' }));

      expect(test.sentThrough()[0].to).toEqual([{ address: 'ada@example.com', name: 'Ada Lovelace' }]);
    });
  });

  describe('raw messages', () => {
    it('sends subject + html without a mailable', async () => {
      await test.manager.raw('Ping', '<p>Pong</p>', (message: MailMessage) => message.addTo('ada@example.com'));

      const [message] = test.sentThrough();

      expect(message.subject).toBe('Ping');
      expect(message.html).toBe('<p>Pong</p>');
      expect(message.to).toEqual([{ address: 'ada@example.com' }]);
    });

    it('exposes html() and text() shortcuts', async () => {
      const mailer = new Mailer(new ArrayTransport(), new MessageRenderer());
      const transport = mailer.getTransport() as ArrayTransport;

      await mailer.html('<b>hi</b>', (message: MailMessage) => {
        message.subject = 'Html';
        message.addFrom('from@test.dev');
      });

      await mailer.text('plain hi', (message: MailMessage) => message.addTo('ada@example.com'));

      expect(transport.messages[0].html).toBe('<b>hi</b>');
      expect(transport.messages[0].subject).toBe('Html');
      expect(transport.messages[1].text).toBe('plain hi');
      expect(transport.messages[1].to).toEqual([{ address: 'ada@example.com' }]);
    });
  });

  describe('queued delivery', () => {
    it('queue() runs the job on the sync driver and delivers the message', async () => {
      await test.manager.queue(new WelcomeMail({ email: 'ada@example.com', name: 'Ada' }), ['ada@example.com']);

      const [message] = test.sentThrough();

      expect(message.html).toBe('<p>Hello Ada</p>');
      expect(message.to).toEqual([{ address: 'ada@example.com' }]);
    });

    it('later() also delivers through the sync driver', async () => {
      await test.manager.later(60, new WelcomeMail({ email: 'ada@example.com', name: 'Ada' }));

      expect(test.sentThrough()).toHaveLength(1);
    });

    it('explains itself when no queue subsystem is registered', async () => {
      const mailer = new Mailer(new ArrayTransport(), new MessageRenderer());

      await expect(mailer.queue(new WelcomeMail({ email: 'a@b.c', name: 'A' }))).rejects.toThrow(
        /QueueServiceProvider/
      );
    });
  });
});
