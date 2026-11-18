/**
 * Notification -> broadcasting integration
 *
 * The notification `broadcast` channel delegates to the `broadcast` container
 * binding; now that a real BroadcastManager lives there, a notification routed
 * to the channel reaches the active driver with the normalised
 * (channels, event, payload) triple.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LogBroadcaster } from '@/Broadcasting/Broadcasters/LogBroadcaster';
import { BroadcastChannel } from '@/Notifications/Channels/BroadcastChannel';
import { Notification } from '@/Notifications/Notification';
import type { BroadcastTestApp } from './support';
import { createBroadcastApp } from './support';

class InvoicePaid extends Notification {
  constructor(public readonly invoiceId: number) {
    super();
  }

  via(): string[] {
    return ['broadcast'];
  }

  toBroadcast(): Record<string, any> {
    return { subject: `Invoice #${this.invoiceId} paid` };
  }
}

describe('notification broadcast channel', () => {
  let test: BroadcastTestApp;

  beforeEach(async () => {
    test = await createBroadcastApp({ broadcasting: { default: 'log', connections: { log: { driver: 'log' } } } });
  });

  afterEach(async () => {
    await test.cleanup();
  });

  it('delivers a broadcast notification through the container broadcaster', async () => {
    const channel = test.manager.connection() as LogBroadcaster;
    const notifiable = { routeNotificationFor: () => ['invoices.5'] };

    const broadcastChannel = new BroadcastChannel(() => test.manager as any);
    await broadcastChannel.send(notifiable, new InvoicePaid(5));

    expect(channel.messages).toHaveLength(1);
    expect(channel.messages[0].channels).toEqual(['invoices.5']);
    expect(channel.messages[0].event).toBe('InvoicePaid');
    expect(channel.messages[0].payload).toEqual({ subject: 'Invoice #5 paid' });
  });
});
