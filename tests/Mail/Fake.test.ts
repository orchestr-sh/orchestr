/**
 * Mail.fake() and the Mail facade
 *
 * The facade is a container proxy over the `mailer` binding, and fake()
 * swaps that binding for the MailFake recorder (bound through the shared
 * Testing installer so facade and TestCase entry points agree). These
 * tests pin the send paths the facade exposes and the assertion surface
 * the ticket promises: fake / assertSent / assertSentTo / assertNotSent.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Mail } from '@/Facades/Mail';
import { Mailable } from '@/Mail/Mailable';
import { Facade } from '@/Support/Facade';
import { Mail as TestingMail } from '@/Testing/Fakes';
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

class FarewellMail extends Mailable {
  content(): void {
    this.text('Goodbye');
  }
}

describe('Mail fake', () => {
  let test: MailTestApp;

  beforeEach(async () => {
    test = await createMailApp();
  });

  afterEach(async () => {
    TestingMail.stop();
    await test.cleanup();
  });

  it('Mail.fake() rebinds the mailer key and returns the recorder', () => {
    const fake = Mail.fake();

    expect(test.app.make('mailer')).toBe(fake);
    expect(Facade.getFacadeApplication().make('mailer')).toBe(fake);
  });

  it('records sends instead of delivering them', async () => {
    const fake = Mail.fake();

    await Mail.to('ada@example.com').send(new WelcomeMail({ email: 'ada@example.com', name: 'Ada' }));

    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0].recipients).toEqual(['ada@example.com']);

    // The real transport saw nothing.
    expect(test.sentThrough()).toHaveLength(0);
  });

  it('assertSent accepts a class, a callback, or both', async () => {
    const fake = Mail.fake();

    await Mail.to('ada@example.com').send(new WelcomeMail({ email: 'a@b.c', name: 'Ada' }));
    await Mail.send(new FarewellMail(), ['grace@example.com']);

    fake.assertSent(WelcomeMail);
    fake.assertSent(FarewellMail, (mailable) => mailable instanceof FarewellMail);
    Mail.assertSent((mailable: unknown) => mailable instanceof WelcomeMail);
  });

  it('assertSentTo matches recipients, including cc chains', async () => {
    const fake = Mail.fake();

    await Mail.to('ada@example.com')
      .cc('grace@example.com')
      .send(new WelcomeMail({ email: 'a@b.c', name: 'A' }));

    fake.assertSentTo('ada@example.com');
    fake.assertSentTo('grace@example.com');
    fake.assertSentTo('ada@example.com', WelcomeMail);
    Mail.assertSentTo('grace@example.com', WelcomeMail);
  });

  it('assertNotSent / assertNotSentTo / assertNothingSent', async () => {
    const fake = Mail.fake();

    fake.assertNothingSent();
    fake.assertNotSent(WelcomeMail);
    fake.assertNotSentTo('ada@example.com');

    await Mail.to('ada@example.com').send(new WelcomeMail({ email: 'a@b.c', name: 'A' }));

    fake.assertNotSent(FarewellMail);
    fake.assertNotSentTo('grace@example.com');

    expect(() => fake.assertNothingSent()).toThrow(/Expected no mail to be sent/);
    expect(() => fake.assertNotSent(WelcomeMail)).toThrow(/unexpectedly sent/);
    expect(() => fake.assertSentTo('nobody@example.com')).toThrow(/No mail was sent to \[nobody@example.com\]/);
    expect(() => fake.assertSentTo('ada@example.com', FarewellMail)).toThrow(/No mail \[FarewellMail\] was sent/);
  });

  it('records queue() and later() as queued messages', async () => {
    const fake = Mail.fake();

    await Mail.queue(new WelcomeMail({ email: 'a@b.c', name: 'A' }), ['ada@example.com']);
    await Mail.later(60, new FarewellMail(), ['grace@example.com']);

    fake.assertQueued(WelcomeMail);
    fake.assertQueued(FarewellMail);
    fake.assertNothingSent();

    expect(fake.queued.map((record) => record.recipients)).toEqual([['ada@example.com'], ['grace@example.com']]);
  });

  it('supports queueing through the fluent chain and raw messages', async () => {
    const fake = Mail.fake();

    await Mail.to('ada@example.com').queue(new WelcomeMail({ email: 'a@b.c', name: 'A' }));

    fake.assertQueued(WelcomeMail);
    fake.assertNotSentTo('nobody@example.com');

    await Mail.raw('Ping', '<p>Pong</p>', (message) => message.addTo('ops@app.test'));

    fake.assertSent((mailable: any) => mailable.subject === 'Ping');
    fake.assertSentTo('ops@app.test');
  });

  it('shares the active fake with the Testing installer', async () => {
    const fake = Mail.fake();

    expect(TestingMail.instance()).toBe(fake);

    await Mail.send(new FarewellMail(), ['ada@example.com']);

    TestingMail.assertSent(FarewellMail);
    expect(() => TestingMail.assertNotSent(FarewellMail)).toThrow(/unexpectedly sent/);
  });

  it('assertSentTimes counts occurrences', async () => {
    const fake = Mail.fake();

    await Mail.send(new FarewellMail());
    await Mail.send(new FarewellMail());

    fake.assertSentTimes(FarewellMail, 2);

    expect(() => fake.assertSentTimes(FarewellMail, 3)).toThrow(/to be sent 3 time\(s\), but it was sent 2/);
  });
});
