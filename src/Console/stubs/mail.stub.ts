/**
 * Mail stub - a renderable message built on the framework's view layer.
 *
 * Laravel: Illuminate\Foundation\Console\MailMakeCommand.
 */
export default `/**
 * {{ class }}
 *
 * Namespace: {{ namespace }}
 */

import { view } from '@orchestr-sh/orchestr';
import type { View } from '@orchestr-sh/orchestr';

export class {{ class }} {
  /**
   * The email's subject line.
   */
  public subject = '{{ subject }}';

  /**
   * Create a new mail message instance.
   */
  constructor(
    // Add your mail data here, e.g.: public readonly order: Order
  ) {}

  /**
   * Build the mail message.
   */
  content(): View {
    return view('{{ view_name }}', {
      mail: this,
    });
  }
}
`;
