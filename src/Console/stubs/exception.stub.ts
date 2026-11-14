/**
 * Exception stub.
 *
 * Laravel: Illuminate\Foundation\Console\ExceptionMakeCommand.
 */
export default `/**
 * {{ class }}
 *
 * Namespace: {{ namespace }}
 */

export class {{ class }} extends Error {
  /**
   * Create a new exception instance.
   */
  constructor(message: string = '{{ message }}', options?: ErrorOptions) {
    super(message, options);

    this.name = '{{ class }}';
  }
}
`;
