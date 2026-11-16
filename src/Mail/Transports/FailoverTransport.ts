/**
 * FailoverTransport - tries a list of transports in order, moving to the
 * next only when the previous one rejects.
 *
 * Laravel's failover mailer (`mail.mailers.failover.mailers`) wraps
 * Symfony's FailoverTransport with a cache-backed cooldown period; this
 * port keeps the same user-visible behaviour - "send through the first
 * transport that works" - without the cooldown bookkeeping, which belongs
 * to the cache layer, not to the transport contract (SRP).
 */

import type { Transport } from '@/Mail/Contracts/Transport';
import type { MailMessage } from '@/Mail/MailMessage';
import { Logger } from '@/Log/Logger';

export interface FailoverTransportOptions {
  /**
   * Optional logger; transport failures are written as warnings so the
   * fallback stays visible without throwing.
   */
  logger?: Logger;
}

export class FailoverTransport implements Transport {
  constructor(
    protected transports: Transport[],
    protected options: FailoverTransportOptions = {}
  ) {}

  /**
   * The underlying transports, in attempt order.
   */
  getTransports(): Transport[] {
    return this.transports;
  }

  async send(message: MailMessage): Promise<void> {
    const errors: unknown[] = [];

    for (const transport of this.transports) {
      try {
        await transport.send(message);

        return;
      } catch (error) {
        errors.push(error);

        this.options.logger?.warning(Logger.toMessage(error));
      }
    }

    const last = errors[errors.length - 1];

    throw new Error(
      `All ${this.transports.length} failover mail transports failed. Last error: ${Logger.toMessage(last)}`,
      { cause: last instanceof Error ? last : undefined }
    );
  }
}
