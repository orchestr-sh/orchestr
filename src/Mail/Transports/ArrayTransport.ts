/**
 * ArrayTransport - messages are collected in memory instead of sent.
 *
 * The testing counterpart of Laravel's array mailer: `Mail::assertSent()`
 * style flows, and the `array` config transport, read the recorded
 * messages straight back off the transport.
 *
 * Mirrors Symfony\Component\Mailer\Transport\NullTransport's role in test
 * suites, extended to retain fully rendered messages.
 */

import type { Transport } from '@/Mail/Contracts/Transport';
import type { MailMessage } from '@/Mail/MailMessage';

export class ArrayTransport implements Transport {
  /**
   * Every message handed to this transport, in send order.
   */
  public readonly messages: MailMessage[] = [];

  async send(message: MailMessage): Promise<void> {
    this.messages.push(message);
  }

  /**
   * The number of stored messages.
   * Laravel: ArrayTransport::messageCount()
   */
  messageCount(): number {
    return this.messages.length;
  }

  /**
   * Forget every stored message.
   * Laravel: ArrayTransport::reset()
   */
  reset(): void {
    this.messages.length = 0;
  }
}
