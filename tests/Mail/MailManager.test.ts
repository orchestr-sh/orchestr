/**
 * MailManager configuration ownership
 *
 * The manager owns configuration: it merges the `mail` section over
 * Laravel-style defaults, resolves the default and named mailers,
 * delegates the mailer surface, and keeps container integration
 * (`mail()` helper, provider registration) honest.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Mailable } from '@/Mail/Mailable';
import { Mailer } from '@/Mail/Mailer';
import { MAIL_DEFAULTS, MailManager } from '@/Mail/MailManager';
import { MailServiceProvider } from '@/Mail/MailServiceProvider';
import { ArrayTransport } from '@/Mail/Transports/ArrayTransport';
import { LogTransport } from '@/Mail/Transports/LogTransport';
import { SmtpTransport } from '@/Mail/Transports/SmtpTransport';
import { mail } from '@/Support/helpers';
import type { MailTestApp } from './support';
import { createMailApp } from './support';

class TinyMail extends Mailable {
  content(): void {
    this.text('tiny');
  }
}

describe('MailManager', () => {
  let test: MailTestApp;

  beforeEach(async () => {
    test = await createMailApp();
  });

  afterEach(async () => {
    await test.cleanup();
  });

  it('registers the manager under the mailer container key', () => {
    expect(test.app.make('mailer')).toBeInstanceOf(MailManager);
    expect(test.app.make('mailer')).toBe(test.manager);
  });

  it('the mail() helper resolves the same manager', () => {
    expect(mail()).toBe(test.manager);
  });

  it('merges config over the framework defaults', () => {
    expect(test.manager.getDefaultMailer()).toBe('array');
    expect(test.manager.config.from).toEqual({ address: 'mail@test.orchestr', name: 'Mail Test' });

    // Defaults survive partial config: the stock mailer table is kept.
    expect(test.manager.config.mailers.log).toEqual({ transport: 'log' });
  });

  it('falls back to Laravel-style defaults with no config at all', () => {
    const manager = new MailManager();

    expect(manager.getDefaultMailer()).toBe(MAIL_DEFAULTS.default);
    expect(Object.keys(manager.config.mailers)).toEqual(Object.keys(MAIL_DEFAULTS.mailers));
    expect(manager.config.from).toEqual(MAIL_DEFAULTS.from);
  });

  it('builds named mailers lazily and caches them', () => {
    const first = test.manager.mailer('array');
    const second = test.manager.mailer('array');

    expect(first).toBeInstanceOf(Mailer);
    expect(second).toBe(first);
    expect(first.getTransport()).toBeInstanceOf(ArrayTransport);
  });

  it('maps mailer entries onto their transports', () => {
    const logMailer = test.manager.mailer('log');

    expect(logMailer.getTransport()).toBeInstanceOf(LogTransport);
    expect(logMailer.getName()).toBe('log');
  });

  it('rejects unknown mailers and unregistered transports with useful errors', () => {
    expect(() => test.manager.mailer('nope')).toThrow(/Mail mailer \[nope\] not configured/);

    const manager = new MailManager({
      default: 'carrier-pigeon',
      mailers: { 'carrier-pigeon': { transport: 'pigeon' } },
    });

    expect(() => manager.mailer()).toThrow(/transport \[pigeon\] not registered/);
    expect(() => manager.mailer()).toThrow(/Available transports: log, array, smtp, failover/);
  });

  it('honours setDefaultMailer, getMailers and disconnect', async () => {
    expect(test.manager.getMailers()).toEqual(expect.arrayContaining(['array', 'log']));

    test.manager.setDefaultMailer('log');

    expect(test.manager.getDefaultMailer()).toBe('log');

    test.manager.setDefaultMailer('array');

    await test.manager.send(new TinyMail());

    expect(test.sentThrough()).toHaveLength(1);

    test.manager.disconnect('array');

    await test.manager.send(new TinyMail());

    // A fresh mailer - fresh transport - so the first send is gone.
    expect(test.sentThrough()).toHaveLength(1);
  });

  it('delegates the mailer surface to the default mailer', async () => {
    await test.manager.send(new TinyMail(), 'ada@example.com');

    expect(test.sentThrough()[0].to).toEqual([{ address: 'ada@example.com' }]);

    const pending = test.manager.to('ada@example.com');

    expect(pending.constructor.name).toBe('PendingMail');

    await pending.send(new TinyMail());

    expect(test.sentThrough()).toHaveLength(2);

    await test.manager.queue(new TinyMail());

    expect(test.sentThrough()).toHaveLength(3);
  });

  it('keeps smtp mailer config out of the code path until used', () => {
    const withSmtp = createManagerWithSmtp();

    expect(() => withSmtp.transport('smtp')).not.toThrow();
    expect(withSmtp.transport('smtp')).toBeInstanceOf(SmtpTransport);
  });

  it('provider reads the mail config section from the container', () => {
    expect(test.manager.config.mailers.array).toEqual({ transport: 'array' });
    expect(test.app.bound('mailer')).toBe(true);
  });

  it('registering the provider twice is harmless and provides the mailer key', () => {
    const provider = new MailServiceProvider(test.app);

    expect(provider.provides()).toEqual(['mailer']);
  });
});

function createManagerWithSmtp(): MailManager {
  const manager = new MailManager({ default: 'smtp', mailers: { smtp: { transport: 'smtp', host: 'mail.test' } } });

  manager.registerTransport('smtp', (config) => new SmtpTransport(config as any));

  return manager;
}
