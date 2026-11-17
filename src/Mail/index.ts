/**
 * Mail Module
 *
 * Laravel-compatible mail: Mailable message descriptions rendered through
 * the view system, a thin Mailer over a Transport contract (smtp via the
 * optional nodemailer peer dependency, log, array, failover), a
 * MailManager owning the `mail` configuration, the `mailer` container
 * binding's service provider, and the queueing wrapper for delayed
 * delivery.
 */

// Core
export { Mailable } from './Mailable';
export type { AttachmentOptions, ContentConfig, EnvelopeConfig, MailViewConfig } from './Mailable';
export { Mailer } from './Mailer';
export type { MailerOptions, RecipientBag, RecipientsInput } from './Mailer';
export { MailManager, MAIL_DEFAULTS } from './MailManager';
export type { MailConfig, MailFromConfig, TransportFactory } from './MailManager';
export { MailMessage } from './MailMessage';
export type { AddressLike, AttachmentDefinition, MailAddress, ResolvedAttachment } from './MailMessage';
export { normalizeAddress, normalizeAddresses, formatAddress } from './MailMessage';
export { MessageRenderer } from './MessageRenderer';
export type { MailableLike, RendererOptions } from './MessageRenderer';
export { PendingMail } from './PendingMail';
export { SendQueuedMailable } from './SendQueuedMailable';
export { MailServiceProvider } from './MailServiceProvider';
export { markdownToHtml } from './Markdown';

// Contracts
export type { MailerConfig, Transport } from './Contracts/Transport';
export type { QueueDispatcherLike } from './Contracts/QueueDispatcher';

// Transports
export { ArrayTransport } from './Transports/ArrayTransport';
export { FailoverTransport } from './Transports/FailoverTransport';
export type { FailoverTransportOptions } from './Transports/FailoverTransport';
export { LogTransport } from './Transports/LogTransport';
export type { LogTransportOptions } from './Transports/LogTransport';
export { SmtpTransport } from './Transports/SmtpTransport';
export type { SmtpClient, SmtpMail, SmtpTransportConfig } from './Transports/SmtpTransport';
