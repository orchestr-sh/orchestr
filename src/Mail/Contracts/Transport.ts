/**
 * Transport contract
 *
 * The single seam between the mail layer and the outside world (OCP): a
 * Mailer hands every fully rendered MailMessage to a Transport, and new
 * delivery mechanisms - SMTP, log, array, failover, an S3-polling queue,
 * anything - plug in behind this interface without touching Mailable,
 * Mailer or the manager.
 *
 * Mirrors Symfony\Component\Mailer\Transport\TransportInterface (simplified
 * to the delivery verb Laravel's transport managers actually use).
 */

import type { MailMessage } from '@/Mail/MailMessage';

export interface Transport {
  /**
   * Deliver (or record, or log) the given rendered message. Rejects when
   * delivery fails; callers - not transports - decide about retries.
   */
  send(message: MailMessage): Promise<void>;
}

/**
 * Transport-level configuration as it appears in one `mail.mailers.*`
 * entry. `transport` names the driver; the remaining keys are driver
 * specific and deliberately open (OCP: new transports define their own
 * config keys without touching this contract).
 */
export interface MailerConfig {
  /**
   * Transport driver name; `driver` is accepted as an alias so mailer
   * entries read like the queue/cache/database sections.
   */
  transport?: string;
  driver?: string;

  [key: string]: any;
}
