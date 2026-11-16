/**
 * Mailable envelope & content construction
 *
 * Mailable describes a message and nothing else (SRP): these tests pin
 * the fluent setters/getters, the address normalisation, both hook
 * styles (v10 return values and v8 fluent calls) and the attachment
 * definitions before anything is rendered or sent.
 */

import { describe, it, expect } from 'vitest';
import { Mailable } from '@/Mail/Mailable';

class PlainMail extends Mailable {}

class FluentMail extends Mailable {
  envelope(): void {
    this.from('sender@example.com', 'Sender').to('ada@example.com').cc('grace@example.com').subject('Fluent');
  }

  content(): void {
    this.view('mail.fluent', { name: 'Ada' }).with({ extra: true });
  }
}

class HookedAttachments extends Mailable {
  attachments() {
    return [{ content: 'hooked', filename: 'hook.txt' }];
  }
}

describe('Mailable', () => {
  describe('envelope construction', () => {
    it('keeps every address field empty by default', () => {
      const mail = new PlainMail();

      expect(mail.from()).toBeUndefined();
      expect(mail.to()).toEqual([]);
      expect(mail.cc()).toEqual([]);
      expect(mail.bcc()).toEqual([]);
      expect(mail.replyTo()).toEqual([]);
      expect(mail.subject()).toBeUndefined();
    });

    it('normalises fluent addresses and returns this for chaining', () => {
      const mail = new PlainMail();

      const returned = mail
        .from('ada@example.com', 'Ada Lovelace')
        .to('grace@example.com', ['alice@example.com', 'bob@example.com'])
        .cc('carol@example.com')
        .bcc('dave@example.com')
        .replyTo('help@example.com');

      expect(returned).toBe(mail);

      expect(mail.from()).toEqual({ address: 'ada@example.com', name: 'Ada Lovelace' });
      expect(mail.to()).toEqual([
        { address: 'grace@example.com' },
        { address: 'alice@example.com' },
        { address: 'bob@example.com' },
      ]);
      expect(mail.cc()).toEqual([{ address: 'carol@example.com' }]);
      expect(mail.bcc()).toEqual([{ address: 'dave@example.com' }]);
      expect(mail.replyTo()).toEqual([{ address: 'help@example.com' }]);
    });

    it('accepts the { email, name } shape found on user models', () => {
      const mail = new PlainMail().to({ email: 'ada@example.com', name: 'Ada' });

      expect(mail.to()).toEqual([{ address: 'ada@example.com', name: 'Ada' }]);
    });

    it('throws when an address object carries neither address nor email', () => {
      expect(() => new PlainMail().to({ nope: true } as never)).toThrow(/address/i);
    });

    it('lets from() and subject() double as getters', () => {
      const mail = new PlainMail().subject('Order Shipped');

      expect(mail.subject()).toBe('Order Shipped');

      mail.from({ address: 'shop@example.com', name: 'Shop' });

      expect(mail.from()).toEqual({ address: 'shop@example.com', name: 'Shop' });
    });
  });

  describe('content declaration', () => {
    it('stores view names and merges view data from view() and with()', () => {
      const mail = new PlainMail().view('mail.invoice', { total: 10 }).with({ currency: 'GBP' });

      expect(mail.view()).toEqual({ name: 'mail.invoice', data: { total: 10, currency: 'GBP' } });
      expect(mail.with()).toEqual({ total: 10, currency: 'GBP' });
    });

    it('stores raw html and text bodies', () => {
      const mail = new PlainMail().html('<p>hi</p>').text('hi');

      expect(mail.html()).toBe('<p>hi</p>');
      expect(mail.text()).toBe('hi');
    });

    it('stores the markdown template name with its data', () => {
      const mail = new PlainMail().markdown('mail.receipt', { order: 1 });

      expect(mail.markdown()).toEqual({ name: 'mail.receipt', data: { order: 1 } });
    });
  });

  describe('attachments', () => {
    it('records path, data and storage attachments in declaration order', () => {
      const mail = new PlainMail()
        .attach('/tmp/invoice.pdf', { as: 'Invoice.pdf', mime: 'application/pdf' })
        .attachData('hello', 'note.txt')
        .attachFromStorage('files/report.csv', 'Report')
        .attachFromStorageDisk('public', 'files/logo.png');

      expect(mail.getAttachments()).toEqual([
        {
          path: '/tmp/invoice.pdf',
          filename: 'Invoice.pdf',
          contentType: 'application/pdf',
          inline: undefined,
          cid: undefined,
        },
        { content: 'hello', filename: 'note.txt', contentType: undefined, inline: undefined, cid: undefined },
        {
          storagePath: 'files/report.csv',
          filename: 'Report',
          disk: undefined,
          contentType: undefined,
          inline: undefined,
          cid: undefined,
        },
        {
          storagePath: 'files/logo.png',
          filename: undefined,
          disk: 'public',
          contentType: undefined,
          inline: undefined,
          cid: undefined,
        },
      ]);
    });

    it('defaults the attachFromStorage options when no name is given', () => {
      const mail = new PlainMail().attachFromStorage('files/report.csv');

      expect(mail.getAttachments()[0]).toMatchObject({ storagePath: 'files/report.csv', filename: undefined });
    });

    it('accepts a raw definition through attachment()', () => {
      const mail = new PlainMail().attachment({ content: Buffer.from('x'), filename: 'x.bin', inline: true });

      expect(mail.getAttachments()).toHaveLength(1);
      expect(mail.getAttachments()[0].inline).toBe(true);
    });
  });

  describe('hooks', () => {
    it('runs fluent-style envelope()/content() overrides', () => {
      const mail = new FluentMail();

      mail.envelope();
      mail.content();

      expect(mail.subject()).toBe('Fluent');
      expect(mail.to()).toEqual([{ address: 'ada@example.com' }]);
      expect(mail.view()?.name).toBe('mail.fluent');
      expect(mail.with()).toEqual({ name: 'Ada', extra: true });
    });

    it('keeps the base hooks as no-ops', () => {
      const mail = new PlainMail();

      expect(mail.envelope()).toBeUndefined();
      expect(mail.content()).toBeUndefined();
      expect(mail.attachments()).toEqual([]);
    });

    it('lets the attachments() hook declare messages', () => {
      expect(new HookedAttachments().attachments()).toEqual([{ content: 'hooked', filename: 'hook.txt' }]);
    });
  });
});
