/**
 * Mail stub - a renderable message built on the framework's mail layer.
 *
 * Laravel: Illuminate\Foundation\Console\MailMakeCommand.
 */
export default `/**
 * {{ class }}
 *
 * Namespace: {{ namespace }}
 */

import { Mailable } from '@orchestr-sh/orchestr';

export class {{ class }} extends Mailable {
  /**
   * Create a new mail message instance.
   */
  constructor(
    // Add your mail data here, e.g.: public readonly order: Order
  ) {
    super();
  }

  /**
   * Build the message envelope: sender, recipients and subject.
   */
  envelope(): void {
    this.subject('{{ subject }}');
  }

  /**
   * Build the message content.
   */
  content(): void {
    this.view('{{ view_name }}', {
      mail: this,
    });
  }
}
`;
