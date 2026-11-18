/**
 * Fake installers
 *
 * The Mail::fake() / Notification::fake() / Http::fake()-style entry
 * points. Queue, Event, Storage and Cache expose fake() on their own
 * facades; the Mail and Notification facades delegate here now that the
 * real subsystems exist. The Http installer stays a fetch-level
 * double: it intercepts *any* outbound fetch, including code that
 * never touches the HTTP client. Requests made through the client are
 * faked - with sequences, patterns and the full assertion suite - on
 * the Http facade's own fake() (Illuminate\Http\Client).
 */

import type { Application } from '@/Foundation/Application';
import type { StubResponse } from '@/Support/Testing/Fakes/HttpFake';
import { HttpFake } from '@/Support/Testing/Fakes/HttpFake';
import { MailFake } from '@/Support/Testing/Fakes/MailFake';
import { NotificationFake } from '@/Support/Testing/Fakes/NotificationFake';

let currentHttp: HttpFake | null = null;
let currentMail: MailFake | null = null;
let currentNotifications: NotificationFake | null = null;

/**
 * Outbound HTTP: fake() intercepts global fetch, recording requests and
 * answering them from stubs
 * Laravel: Http::fake()
 */
export const Http = {
  /**
   * Start faking outbound requests (replacing any active fake)
   */
  fake(stubs: Record<string, StubResponse> | StubResponse = {}): HttpFake {
    currentHttp?.restore();

    currentHttp = new HttpFake();

    return currentHttp.fake(stubs);
  },

  /**
   * The active fake, if any
   */
  instance(): HttpFake | null {
    return currentHttp;
  },

  /**
   * Assert a request was recorded by the active fake
   * Laravel: Http::assertSent()
   */
  assertSent(...args: Parameters<HttpFake['assertSent']>): void {
    mustFake(currentHttp, 'Http').assertSent(...args);
  },

  /**
   * Assert no matching request was recorded
   * Laravel: Http::assertNotSent()
   */
  assertNotSent(...args: Parameters<HttpFake['assertNotSent']>): void {
    mustFake(currentHttp, 'Http').assertNotSent(...args);
  },

  /**
   * Recorded requests on the active fake
   */
  recorded(...args: Parameters<HttpFake['recorded']>) {
    return mustFake(currentHttp, 'Http').recorded(...args);
  },

  /**
   * Stop faking and restore the real fetch
   */
  stop(): void {
    currentHttp?.restore();

    currentHttp = null;
  },
};

/**
 * Mail: fake() records messages instead of delivering them
 * Laravel: Mail::fake()
 */
export const Mail = {
  /**
   * Install a recording mailer; when an application is given the fake is
   * also bound as its 'mailer' so app code resolving the mailer sees it
   */
  fake(app?: Application): MailFake {
    currentMail = new MailFake();

    if (app) {
      app.instance('mailer', currentMail);
    }

    return currentMail;
  },

  /**
   * The active fake, if any
   */
  instance(): MailFake | null {
    return currentMail;
  },

  assertSent(...args: Parameters<MailFake['assertSent']>): void {
    mustFake(currentMail, 'Mail').assertSent(...args);
  },

  assertNotSent(...args: Parameters<MailFake['assertNotSent']>): void {
    mustFake(currentMail, 'Mail').assertNotSent(...args);
  },

  assertNothingSent(): void {
    mustFake(currentMail, 'Mail').assertNothingSent();
  },

  /**
   * Discard the recorder (container bindings go with their application)
   */
  stop(): void {
    currentMail = null;
  },
};

/**
 * Notifications: fake() records sends instead of running channels
 * Laravel: Notification::fake()
 */
export const Notification = {
  fake(app?: Application): NotificationFake {
    currentNotifications = new NotificationFake();

    if (app) {
      app.instance('notifications', currentNotifications);
    }

    return currentNotifications;
  },

  instance(): NotificationFake | null {
    return currentNotifications;
  },

  assertSent(...args: Parameters<NotificationFake['assertSent']>): void {
    mustFake(currentNotifications, 'Notification').assertSent(...args);
  },

  assertNotSent(...args: Parameters<NotificationFake['assertNotSent']>): void {
    mustFake(currentNotifications, 'Notification').assertNotSent(...args);
  },

  assertSentTo(...args: Parameters<NotificationFake['assertSentTo']>): void {
    mustFake(currentNotifications, 'Notification').assertSentTo(...args);
  },

  assertNotSentTo(...args: Parameters<NotificationFake['assertNotSentTo']>): void {
    mustFake(currentNotifications, 'Notification').assertNotSentTo(...args);
  },

  assertSentOnDemand(...args: Parameters<NotificationFake['assertSentOnDemand']>): void {
    mustFake(currentNotifications, 'Notification').assertSentOnDemand(...args);
  },

  assertCount(...args: Parameters<NotificationFake['assertCount']>): void {
    mustFake(currentNotifications, 'Notification').assertCount(...args);
  },

  assertNothingSent(): void {
    mustFake(currentNotifications, 'Notification').assertNothingSent();
  },

  stop(): void {
    currentNotifications = null;
  },
};

/**
 * Shared guard for the static assertion helpers
 */
function mustFake<T>(fake: T | null, name: string): T {
  if (!fake) {
    throw new Error(`${name} is not being faked. Call ${name}.fake() first.`);
  }

  return fake;
}
