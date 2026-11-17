/**
 * The Notification facade, the helper and the service provider
 *
 * `notifications` is the container key everything routes through: the
 * provider builds the sender from the `notifications` config section, the
 * facade and the `notification()` helper are proxies over that binding,
 * and custom channels can be contributed declaratively.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Notification as NotificationFacade } from '@/Facades/Notification';
import { Application } from '@/Foundation/Application';
import { Config } from '@/Foundation/Config/Config';
import { BroadcastChannel } from '@/Notifications/Channels/BroadcastChannel';
import { DatabaseChannel } from '@/Notifications/Channels/DatabaseChannel';
import { MailChannel } from '@/Notifications/Channels/MailChannel';
import { Notification } from '@/Notifications/Notification';
import { NotificationSender } from '@/Notifications/NotificationSender';
import { NotificationServiceProvider } from '@/Notifications/NotificationServiceProvider';
import { Facade } from '@/Support/Facade';
import { notification } from '@/Support/helpers';
import type { NotificationTestApp } from './support';
import { InvoicePaid, createNotificationApp, recipient } from './support';

describe('Notification facade', () => {
  let test: NotificationTestApp;

  beforeEach(async () => {
    test = await createNotificationApp({ database: true });
  });

  afterEach(async () => {
    await test.cleanup();
  });

  it('proxies delivery calls onto the sender', async () => {
    await NotificationFacade.send(recipient('ada@example.com'), new InvoicePaid({ id: 1, total: '£1' }));
    await NotificationFacade.sendNow(recipient('grace@example.com'), new InvoicePaid({ id: 2, total: '£2' }));

    expect(test.sentThrough()).toHaveLength(2);
  });

  it('exposes the channel registry through the facade', () => {
    expect(NotificationFacade.getChannels()).toEqual(['mail', 'database', 'broadcast']);
    expect(NotificationFacade.channel('mail')).toBeInstanceOf(MailChannel);
    expect(NotificationFacade.channel('database')).toBeInstanceOf(DatabaseChannel);
    expect(NotificationFacade.channel('broadcast')).toBeInstanceOf(BroadcastChannel);
    expect(() => NotificationFacade.channel('telegram')).toThrow(/is not supported/);
  });

  it('extend() registers a channel the facade can then deliver on', async () => {
    const delivered: string[] = [];

    NotificationFacade.extend('pager', {
      async send(notifiable: any): Promise<unknown> {
        delivered.push(String(notifiable.routeNotificationFor('pager')));

        return 'paged';
      },
    });

    class PagedPaid extends Notification {
      via(): string[] {
        return ['pager'];
      }
    }

    await NotificationFacade.sendNow({ routeNotificationFor: () => '555-0100' }, new PagedPaid());

    expect(delivered).toEqual(['555-0100']);
    expect(NotificationFacade.getChannels()).toContain('pager');
  });

  it('on() and later() are reachable from the facade too', async () => {
    const pending = NotificationFacade.on({ mail: 'guest@example.com' });

    await pending.notify(new InvoicePaid({ id: 3, total: '£3' }));

    expect(test.sentThrough()[0].to[0].address).toBe('guest@example.com');
  });

  it('the notification() helper is the same binding', () => {
    expect(notification()).toBe(test.sender);
    expect(NotificationFacade.getChannels).toBeInstanceOf(Function);
  });
});

describe('NotificationServiceProvider', () => {
  it('builds the sender from the notifications config section', async () => {
    const base = await createNotificationApp();
    const app = new Application(base.base);

    try {
      app.instance('config', new Config({ notifications: { from: { address: 'provider@test.orchestr' } } }));
      app.register(NotificationServiceProvider);
      await app.boot();

      const sender = app.make<NotificationSender>('notifications');

      expect(sender).toBeInstanceOf(NotificationSender);
      expect(sender.config.from?.address).toBe('provider@test.orchestr');
      expect(sender.getChannels()).toEqual(['mail', 'database', 'broadcast']);
    } finally {
      await base.cleanup();
    }
  });

  it('takes channels contributed through configuration', async () => {
    const base = await createNotificationApp();
    const app = new Application(base.base);
    const shipped: unknown[] = [];

    try {
      class Courier {
        async send(): Promise<unknown> {
          shipped.push('courier');

          return null;
        }
      }

      app.instance(
        'config',
        new Config({
          notifications: { channels: { courier: () => new Courier() } },
        })
      );
      app.register(NotificationServiceProvider);
      await app.boot();

      const sender = app.make<NotificationSender>('notifications');

      expect(sender.getChannels()).toEqual(['mail', 'database', 'broadcast', 'courier']);

      class CourierPaid extends Notification {
        via(): string[] {
          return ['courier'];
        }
      }

      await sender.sendNow(recipient('ada@example.com'), new CourierPaid());

      expect(shipped).toEqual(['courier']);
    } finally {
      await base.cleanup();
    }
  });

  it('registers nothing else and reports what it provides', () => {
    const app = new Application('/tmp');
    const provider = new NotificationServiceProvider(app);

    expect(provider.provides()).toEqual(['notifications']);
  });

  it('the facade resolves through the container application', async () => {
    const base = await createNotificationApp();

    try {
      Facade.setFacadeApplication(base.app);

      expect(Facade.getFacadeApplication().make('notifications')).toBeInstanceOf(NotificationSender);
    } finally {
      await base.cleanup();
    }
  });

  it('a container without the binding leaves the helper to complain', () => {
    const app = new Application('/tmp');

    expect(app.bound('notifications')).toBe(false);
    expect(() => notification()).toThrow('Notifications are not available.');
  });
});
