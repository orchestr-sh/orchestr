/**
 * Transport behaviour & selection
 *
 * Everything delivery-specific sits behind the Transport contract (OCP):
 * these tests pin the array transport's recording, the log transport's
 * rendered output (injected logger + optional path file), failover
 * ordering, and the SMTP transport's transport-selection and mapping
 * against a mocked nodemailer client.
 */

import { readFileSync, rmSync } from 'fs';
import { describe, it, expect } from 'vitest';
import type { Handler, LogRecord } from '@/Log/Contracts/Logging';
import type { Transport } from '@/Mail/Contracts/Transport';
import type { SmtpClient, SmtpMail } from '@/Mail/Transports/SmtpTransport';
import { Logger } from '@/Log/Logger';
import { MailManager } from '@/Mail/MailManager';
import { MailMessage } from '@/Mail/MailMessage';
import { ArrayTransport } from '@/Mail/Transports/ArrayTransport';
import { FailoverTransport } from '@/Mail/Transports/FailoverTransport';
import { LogTransport } from '@/Mail/Transports/LogTransport';
import { SmtpTransport } from '@/Mail/Transports/SmtpTransport';

class CapturingHandler implements Handler {
  records: LogRecord[] = [];

  handle(record: LogRecord): void {
    this.records.push(record);
  }

  close(): void {}
}

class FakeSmtpClient implements SmtpClient {
  mails: SmtpMail[] = [];

  async sendMail(mail: SmtpMail): Promise<{ messageId: string }> {
    this.mails.push(mail);

    return { messageId: 'fake-1@test' };
  }
}

class ThrowingTransport implements Transport {
  public sends: MailMessage[] = [];

  constructor(public readonly fails: boolean) {}

  async send(message: MailMessage): Promise<void> {
    if (this.fails) {
      throw new Error('transport down');
    }

    this.sends.push(message);
  }
}

function sampleMessage(): MailMessage {
  const message = new MailMessage();

  message.addFrom({ address: 'shop@test.dev', name: 'Shop' });
  message.addTo('ada@example.com');
  message.addCc('grace@example.com');
  message.addBcc('boss@example.com');
  message.addReplyTo('help@test.dev');
  message.subject = 'Hello there';
  message.html = '<p>Hello ada</p>';
  message.text = 'Hello ada';
  message.withHeader('X-Campaign', 'spring');
  message.attachments.push({ filename: 'note.txt', content: Buffer.from('hi') });

  return message;
}

describe('Transports', () => {
  describe('ArrayTransport', () => {
    it('stores messages for assertions', async () => {
      const transport = new ArrayTransport();

      await transport.send(sampleMessage());

      expect(transport.messageCount()).toBe(1);
      expect(transport.messages[0].subject).toBe('Hello there');

      await transport.send(sampleMessage());

      expect(transport.messages).toHaveLength(2);
    });

    it('resets', async () => {
      const transport = new ArrayTransport();

      await transport.send(sampleMessage());
      transport.reset();

      expect(transport.messages).toEqual([]);
    });
  });

  describe('LogTransport', () => {
    it('writes the rendered message through the injected logger', async () => {
      const handler = new CapturingHandler();
      const transport = new LogTransport({ logger: new Logger(handler, { name: 'mail' }) });

      await transport.send(sampleMessage());

      expect(handler.records).toHaveLength(1);

      const { message } = handler.records[0];

      expect(message).toContain('Subject: Hello there');
      expect(message).toContain('To: ada@example.com');
      expect(message).toContain('<p>Hello ada</p>');
      expect(message).toContain('Hello ada');
      expect(message).toContain('note.txt');
      expect(handler.records[0].context).toMatchObject({
        to: ['ada@example.com', 'grace@example.com', 'boss@example.com'],
        subject: 'Hello there',
      });
    });

    it('does not interpolate curly braces from the body', async () => {
      const handler = new CapturingHandler();
      const transport = new LogTransport({ logger: new Logger(handler) });

      const message = sampleMessage();

      message.html = '<p>Hi {name}, your code is {code}</p>';

      await transport.send(message);

      expect(handler.records[0].message).toContain('Hi {name}, your code is {code}');
    });

    it('appends to a configured log path like mail.mailers.log.path', async () => {
      const path = `/tmp/orchestr-mail-log-${process.pid}-${Date.now()}.log`;
      const handler = new CapturingHandler();
      const transport = new LogTransport({ logger: new Logger(handler), path });

      try {
        await transport.send(sampleMessage());
        await transport.send(sampleMessage());

        const written = readFileSync(path, 'utf-8');

        expect(written.match(/Subject: Hello there/gu)).toHaveLength(2);
      } finally {
        rmSync(path, { force: true });
      }
    });
  });

  describe('FailoverTransport', () => {
    it('uses the first healthy transport', async () => {
      const down = new ThrowingTransport(true);
      const up = new ThrowingTransport(false);
      const failover = new FailoverTransport([down, up]);

      await failover.send(sampleMessage());

      expect(down.sends).toHaveLength(0);
      expect(up.sends).toHaveLength(1);
    });

    it('aggregates when every transport fails', async () => {
      const failover = new FailoverTransport([new ThrowingTransport(true), new ThrowingTransport(true)]);

      await expect(failover.send(sampleMessage())).rejects.toThrow(/All 2 failover mail transports failed/);
    });

    it('surfaces nothing odd for a single healthy transport', async () => {
      const up = new ThrowingTransport(false);

      await new FailoverTransport([up]).send(sampleMessage());

      expect(up.sends).toHaveLength(1);
    });
  });

  describe('SmtpTransport', () => {
    it('maps a rendered message onto nodemailer mail options', async () => {
      const client = new FakeSmtpClient();
      const transport = new SmtpTransport({ host: 'smtp.test', port: 587 }, client);

      await transport.send(sampleMessage());

      const mail = client.mails[0];

      expect(mail.from).toBe('Shop <shop@test.dev>');
      expect(mail.to).toBe('ada@example.com, grace@example.com, boss@example.com');
      expect(mail.cc).toBe('grace@example.com');
      expect(mail.bcc).toBe('boss@example.com');
      expect(mail.replyTo).toBe('help@test.dev');
      expect(mail.subject).toBe('Hello there');
      expect(mail.html).toBe('<p>Hello ada</p>');
      expect(mail.headers).toEqual({ 'X-Campaign': 'spring' });
      expect(mail.attachments).toEqual([
        { filename: 'note.txt', content: Buffer.from('hi'), contentType: undefined, cid: undefined },
      ]);
    });

    it('reuses an injected client and never imports nodemailer', async () => {
      const client = new FakeSmtpClient();
      const transport = new SmtpTransport({}, client);

      await transport.send(sampleMessage());
      await transport.send(sampleMessage());

      expect(client.mails).toHaveLength(2);
      expect(await transport.getClient()).toBe(client);
    });

    it('asks for the optional dependency when no client was provided', async () => {
      const transport = new SmtpTransport({ host: 'smtp.test' });

      // nodemailer is not installed in this repository; the lazy import
      // must surface that as an actionable error, not a module crash.
      await expect(transport.send(sampleMessage())).rejects.toThrow(/nodemailer/);
    });
  });

  describe('MailManager transport selection', () => {
    it('builds the configured transport per mailer, mocked for smtp', async () => {
      const client = new FakeSmtpClient();

      const manager = new MailManager({
        default: 'smtp',
        mailers: {
          smtp: { transport: 'smtp', host: 'smtp.test', port: 2525, client },
          array: { transport: 'array' },
          failover: { transport: 'failover', mailers: ['array'] },
        },
      });

      manager.registerTransport('smtp', (config) => new SmtpTransport(config as any, config.client));
      manager.registerTransport('array', () => new ArrayTransport());
      manager.registerTransport(
        'failover',
        (config) => new FailoverTransport((config.mailers as string[]).map((name) => manager.transport(name)))
      );

      expect(manager.transport('smtp')).toBeInstanceOf(SmtpTransport);

      await manager.mailer('smtp').html('<p>via smtp</p>', (message: MailMessage) => message.addTo('ada@example.com'));

      expect(client.mails).toHaveLength(1);

      // Failover wraps the named siblings; the array transport receives
      // the message through it.
      await manager.mailer('failover').html('<p>via failover</p>');

      expect((manager.transport('array') as ArrayTransport).messages).toHaveLength(1);
    });

    it('fails over to the next mailer when the first transport throws', async () => {
      const up = new ThrowingTransport(false);
      const manager = new MailManager({
        mailers: {
          broken: { transport: 'custom-broken' },
          good: { transport: 'custom-good' },
          chain: { transport: 'failover', mailers: ['broken', 'good'] },
        },
      });

      manager.registerTransport('custom-broken', () => new ThrowingTransport(true));
      manager.registerTransport('custom-good', () => up);
      manager.registerTransport(
        'failover',
        (config) => new FailoverTransport((config.mailers as string[]).map((name) => manager.transport(name)))
      );

      await manager.mailer('chain').send({ subject: 'failover test', text: 'body' });

      expect(up.sends).toHaveLength(1);
    });
  });

  describe('extensibility', () => {
    it('accepts custom transports registered by name (OCP)', async () => {
      const received: MailMessage[] = [];
      const manager = new MailManager({ default: 'memory', mailers: { memory: { transport: 'memory' } } });

      manager.registerTransport('memory', () => ({
        send: async (message: MailMessage) => {
          received.push(message);
        },
      }));

      await manager.send({ subject: 'custom', text: 'body' });

      expect(received).toHaveLength(1);
    });
  });
});
