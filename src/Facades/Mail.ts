/**
 * Mail Facade
 *
 * Static access to the mail manager: send through the default mailer,
 * swap mailers per message, or fake the whole subsystem for tests.
 *
 * @example
 * ```typescript
 * import { Mail } from '@orchestr-sh/orchestr/Facades';
 *
 * await Mail.to('ada@example.com').send(new WelcomeMail(user));
 * await Mail.send(new InvoiceMail(invoice));           // default mailer, mailable owns its to()
 * await Mail.mailer('log').send(new ReceiptMail(order)); // one-off mailer
 *
 * const mail = Mail.fake();
 * await Mail.to('ada@example.com').send(new WelcomeMail(user));
 * mail.assertSent(WelcomeMail);
 * mail.assertSentTo('ada@example.com');
 * ```
 */

import type { MailManager } from '@/Mail/MailManager';
import type { MailFake } from '@/Support/Testing/Fakes/MailFake';
import { Facade } from '@/Support/Facade';
import { Mail as MailInstaller } from '@/Testing/Fakes';

class MailFacadeClass extends Facade {
  protected static getFacadeAccessor(): string {
    return 'mailer';
  }

  /**
   * Fake mail for testing
   *
   * Replaces the `mailer` container binding with a MailFake that records
   * every message instead of delivering it, and provides Laravel-style
   * assertions (assertSent, assertSentTo, assertNotSent, assertQueued,
   * assertNothingSent). Delegates to the shared Testing installer so
   * `this.fakeMail()` in test cases and this facade always agree on the
   * active fake (DRY).
   *
   * @returns MailFake instance for making assertions
   *
   * @example
   * ```typescript
   * const mail = Mail.fake();
   *
   * await Mail.to('ada@example.com').send(new WelcomeMail(user));
   *
   * mail.assertSent(WelcomeMail, (mailable) => mailable.subject() === 'Welcome');
   * ```
   */
  static fake(): MailFake {
    const app = this.getFacadeApplication();

    if (!app) {
      throw new Error('Application not initialized. Cannot fake mail.');
    }

    const fake = MailInstaller.fake(app);

    // Drop any cached facade root so subsequent Mail.* calls resolve the fake.
    this.clearResolvedInstance(this.getFacadeAccessor());

    return fake;
  }

  /**
   * The active mail fake, when mail is being faked through the Testing
   * installer; null otherwise.
   * Laravel: Mail::getFacadeRoot() being a MailFake
   */
  static fakeInstance(): MailFake | null {
    return MailInstaller.instance();
  }
}

export const Mail = new Proxy(MailFacadeClass, {
  get(target, prop) {
    // First check if it's a static method on the facade class itself
    if (prop in target) {
      const value = (target as any)[prop];
      if (typeof value === 'function') {
        return value.bind(target);
      }
      return value;
    }

    // Then try to get from the facade root (the MailManager - or the
    // MailFake once the mailer binding has been swapped)
    try {
      const root = (target as any).getFacadeRoot() as MailManager & MailFake;
      if (root && prop in root) {
        const value = (root as any)[prop];
        if (typeof value === 'function') {
          return (...args: any[]) => value.apply(root, args);
        }
        return value;
      }
    } catch (error) {
      // Facade root not available yet
    }

    return undefined;
  },
}) as unknown as typeof MailFacadeClass & MailManager & MailFake;
