/**
 * AuthenticationMail - the shared mail body of the authentication links.
 *
 * Both notifications this ticket ships (reset password, verify email)
 * deliver "click this signed link" mail: a subject, an explanatory line,
 * one call-to-action button and an outro. Describing that shape once keeps
 * the notification classes honest about what differs between them - the
 * subject, the copy and the route the signed URL points at (DRY).
 */

import { Mailable } from '@/Mail/Mailable';

/**
 * The parts of an authentication link mail.
 */
export interface AuthenticationMailContent {
  subject: string;
  intro: string;
  actionLabel: string;
  url: string;
  outro: string;
}

/**
 * Minimal HTML escaping for embedding the link in the body.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export class AuthenticationMail extends Mailable {
  constructor(protected readonly mail: AuthenticationMailContent) {
    super();
  }

  envelope(): { subject: string } {
    return { subject: this.mail.subject };
  }

  content(): { html: string; text: string } {
    const { intro, actionLabel, outro, url, subject } = this.mail;
    const href = escapeHtml(url);

    return {
      html:
        `<h1>${escapeHtml(subject)}</h1>` +
        `<p>${escapeHtml(intro)}</p>` +
        `<p><a href="${href}">${escapeHtml(actionLabel)}</a></p>` +
        `<p>${escapeHtml(outro)}</p>` +
        `<p>${href}</p>`,
      text: `${subject}\n\n${intro}\n\n${actionLabel}: ${url}\n\n${outro}`,
    };
  }
}
