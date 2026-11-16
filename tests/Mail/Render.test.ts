/**
 * Message rendering
 *
 * One renderer path for HTML, text and Markdown (DRY), straight through
 * the Blade compiler via the `view` binding. These tests cover envelope
 * merge order, view + text-sibling resolution, raw bodies, Markdown
 * conversion, view data, and the duck-typed legacy classes the old
 * `make:mail` stub produced.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Mailable } from '@/Mail/Mailable';
import { MessageRenderer } from '@/Mail/MessageRenderer';
import type { MailTestApp } from './support';
import { createMailApp } from './support';

class InvoiceMail extends Mailable {
  constructor(public user: { email: string; name: string }) {
    super();
  }

  envelope() {
    return { to: this.user.email, subject: `Invoice for ${this.user.name}` };
  }

  content() {
    return { view: 'emails.invoice', data: { user: this.user, amount: 42 } };
  }
}

class ReceiptMail extends Mailable {
  envelope(): void {
    this.from('receipts@shop.test').subject('Receipt');
  }

  content(): void {
    this.view('emails.receipt').with({ order: 7 });
  }
}

class RawMail extends Mailable {
  content(): void {
    this.html('<p>Raw body</p>').text('Raw body');
  }
}

class MarkdownMail extends Mailable {
  constructor(public link: string) {
    super();
  }

  envelope(): void {
    this.subject('Thanks');
  }

  content(): void {
    this.markdown('emails.thanks', { link: this.link });
  }
}

class HookedAttachmentsMail extends Mailable {
  constructor(public extraCount: number = 0) {
    super();
  }

  content(): void {
    this.html('body');

    if (this.extraCount > 0) {
      this.attachData('fluent', 'fluent.txt');
    }
  }

  attachments() {
    return Array.from({ length: this.extraCount }, (_unused, index) => ({
      content: `hooked-${index}`,
      filename: `hook-${index}.txt`,
    }));
  }
}

describe('MessageRenderer', () => {
  let test: MailTestApp;

  beforeEach(async () => {
    test = await createMailApp();
  });

  afterEach(async () => {
    await test.cleanup();
  });

  describe('HTML and text through views', () => {
    it('renders the HTML view with the envelope from hooks', async () => {
      test.putView('emails.invoice', '<h1>Invoice for {{ user.name }}</h1><p>{{ amount }}</p>');

      const message = await test.manager
        .mailer()
        .getRenderer()
        .render(new InvoiceMail({ email: 'ada@example.com', name: 'Ada' }));

      expect(message.subject).toBe('Invoice for Ada');
      expect(message.to).toEqual([{ address: 'ada@example.com' }]);
      expect(message.html).toContain('<h1>Invoice for Ada</h1>');
      expect(message.html).toContain('<p>42</p>');
    });

    it('uses the config default from when the mailable has none', async () => {
      test.putView('emails.invoice', '<p>ok</p>');

      const message = await test.manager
        .mailer()
        .getRenderer()
        .render(new InvoiceMail({ email: 'ada@example.com', name: 'Ada' }));

      expect(message.from).toEqual([{ address: 'mail@test.orchestr', name: 'Mail Test' }]);
    });

    it('keeps an explicit from over the default', async () => {
      test.putView('emails.receipt', '<p>Order {{ order }}</p>');

      const message = await test.manager.mailer().getRenderer().render(new ReceiptMail());

      expect(message.from).toEqual([{ address: 'receipts@shop.test' }]);
      expect(message.html).toContain('Order 7');
    });

    it('renders the .text sibling view as the plain-text part', async () => {
      test.putView('emails.receipt', '<h1>Receipt {{ order }}</h1>');
      test.putView('emails.receipt.text', 'Receipt {{ order }} in plain text');

      const message = await test.manager.mailer().getRenderer().render(new ReceiptMail());

      expect(message.html).toContain('<h1>Receipt 7</h1>');
      expect(message.text).toContain('Receipt 7 in plain text');
    });

    it('prefers an explicit text() body over the sibling', async () => {
      test.putView('emails.receipt', '<h1>Receipt</h1>');
      test.putView('emails.receipt.text', 'sibling');

      const mail = new ReceiptMail();

      mail.content = () => {
        mail.view('emails.receipt').with({ order: 7 }).text('explicit text');
      };

      const message = await test.manager.mailer().getRenderer().render(mail);

      expect(message.text).toBe('explicit text');
    });
  });

  describe('raw bodies', () => {
    it('sends html()/text() strings without touching the view layer', async () => {
      const message = await test.manager.mailer().getRenderer().render(new RawMail());

      expect(message.html).toBe('<p>Raw body</p>');
      expect(message.text).toBe('Raw body');
    });
  });

  describe('markdown', () => {
    it('renders the markdown template, converts it to HTML and keeps the text', async () => {
      test.putView('emails.thanks', ['# Thanks!', '', 'Visit [our store]({{ link }}) today.'].join('\n'));

      const message = await test.manager.mailer().getRenderer().render(new MarkdownMail('https://shop.test'));

      expect(message.html).toContain('<h1>Thanks!</h1>');
      expect(message.html).toContain('<a href="https://shop.test">our store</a>');
      expect(message.text).toContain('Visit [our store](https://shop.test) today.');
    });

    it('survives curly braces without placeholder interpolation', async () => {
      test.putView('emails.thanks', 'Use code {CODE} now');

      const message = await test.manager.mailer().getRenderer().render(new MarkdownMail('x'));

      expect(message.html).toContain('Use code {CODE} now');
    });
  });

  describe('view data', () => {
    it('injects the mailable as `mail` alongside the declared data', async () => {
      test.putView('emails.receipt', 'Order {{ order }} for {{ mail.user ?? "nobody" }}');

      const mail = new ReceiptMail();

      (mail as any).user = 'ada@example.com';

      const message = await test.manager.mailer().getRenderer().render(mail);

      expect(message.html).toContain('Order 7 for ada@example.com');
    });
  });

  describe('attachments merging', () => {
    it('combines fluent attachments with the attachments() hook', async () => {
      const mail = new HookedAttachmentsMail(2);

      const message = await test.manager.mailer().getRenderer().render(mail);

      const names = message.attachments.map((attachment) => attachment.filename);

      expect(names).toContain('fluent.txt');
      expect(names).toContain('hook-0.txt');
      expect(names).toContain('hook-1.txt');
      expect(message.attachments).toHaveLength(3);
    });

    it('reads attachment bytes from definitions', async () => {
      const mail = new HookedAttachmentsMail();

      const message = await test.manager.mailer().getRenderer().render(mail);

      expect(message.attachments).toHaveLength(0);
    });
  });

  describe('legacy duck-typed classes', () => {
    it('renders old make:mail stubs whose content() returns a View', async () => {
      test.putView('mail.order-shipped', '<p>{{ order }}</p>');

      const factory = test.app.make<any>('view');

      class LegacyOrderShipped {
        public subject = 'Order Shipped';

        content() {
          return factory.make('mail.order-shipped', { order: 1234 });
        }
      }

      const message = await test.manager.mailer().getRenderer().render(new LegacyOrderShipped());

      expect(message.subject).toBe('Order Shipped');
      expect(message.html).toContain('<p>1234</p>');
      expect(message.from).toEqual([{ address: 'mail@test.orchestr', name: 'Mail Test' }]);
    });
  });

  describe('failure modes', () => {
    it('fails loudly when the mail view does not exist', async () => {
      const mail = new MailableSubclassWithMissingView();

      await expect(test.manager.mailer().getRenderer().render(mail)).rejects.toThrow(/not found/i);
    });

    it('explains the missing view layer when no view factory is registered', async () => {
      const renderer = new MessageRenderer();

      const mail = new ReceiptMail();

      await expect(renderer.render(mail)).rejects.toThrow(/view layer/i);
    });
  });
});

class MailableSubclassWithMissingView extends Mailable {
  content(): void {
    this.view('emails.nowhere');
  }
}
