/**
 * Notification stub - the channels/subject/toMail/toArray surface Laravel
 * notifications expose, kept framework-free so it compiles before a
 * mailer exists.
 *
 * Laravel: Illuminate\Foundation\Console\NotificationMakeCommand.
 */
export default `/**
 * {{ class }}
 *
 * Namespace: {{ namespace }}
 */

export class {{ class }} {
  /**
   * The notification's subject line.
   */
  public subject = '{{ subject }}';

  /**
   * Create a new notification instance.
   */
  constructor(
    // Add your notification data here
  ) {}

  /**
   * Get the notification's delivery channels.
   */
  via(notifiable: any): string[] {
    return ['mail'];
  }

  /**
   * Get the mail representation of the notification.
   */
  toMail(notifiable: any): object {
    return {
      //
    };
  }

  /**
   * Get the array representation of the notification.
   */
  toArray(notifiable: any): Record<string, any> {
    return {
      //
    };
  }
}
`;
