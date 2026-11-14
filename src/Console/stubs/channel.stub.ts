/**
 * Broadcast channel stub - name plus auth callbacks shaped like Laravel's
 * channel classes, kept framework-free until a broadcasting module lands.
 *
 * Laravel: Illuminate\Foundation\Console\ChannelMakeCommand.
 */
export default `/**
 * {{ class }}
 *
 * Namespace: {{ namespace }}
 */

export class {{ class }} {
  /**
   * The channel this class guards.
   */
  public static channelName = '{{ channel }}';

  /**
   * Determine if the user can subscribe to the channel.
   */
  authenticate(user: any, ...args: string[]): boolean {
    // Example: return args[0] === String(user.getAttribute('id'));
    return true;
  }

  /**
   * The data a presence channel hands to its subscribers.
   */
  joinPresence(user: any): string | Record<string, any> {
    return {};
  }
}
`;
