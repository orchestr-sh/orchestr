/**
 * HttpException - an error carrying the HTTP status, message and headers the
 * exception handler should respond with
 * Laravel: Symfony\Component\HttpKernel\Exception\HttpException
 *
 * Every exception the framework aborts with or renders through the handler
 * is either an HttpException or is mapped onto one; custom headers set here
 * survive onto the response.
 */
export class HttpException extends Error {
  /**
   * The HTTP status code to respond with
   */
  public status: number;

  /**
   * Headers merged into the rendered response
   */
  public headers: Record<string, string>;

  constructor(status: number = 500, message: string = '', headers: Record<string, string> = {}) {
    super(message || httpStatusText(status));
    this.name = 'HttpException';
    this.status = status;
    this.headers = { ...headers };

    // Keep instanceof working when the output is down-levelled
    Object.setPrototypeOf(this, HttpException.prototype);
  }

  /**
   * Get the HTTP status code
   * Laravel: $exception->getStatusCode()
   */
  getStatus(): number {
    return this.status;
  }

  /**
   * Get a copy of the exception's headers
   * Laravel: $exception->getHeaders()
   */
  getHeaders(): Record<string, string> {
    return { ...this.headers };
  }

  /**
   * Get a single header value
   */
  getHeader(name: string): string | undefined {
    return this.headers[name];
  }

  /**
   * Add or replace a header carried onto the response
   */
  withHeader(name: string, value: string): this {
    this.headers[name] = value;
    return this;
  }

  /**
   * Merge headers into the exception
   */
  withHeaders(headers: Record<string, string>): this {
    Object.assign(this.headers, headers);
    return this;
  }
}

/**
 * The reason phrase for a status code, used as the default message when an
 * exception (or abort()) is created without one
 * Laravel: Response::$statusTexts
 */
const STATUS_TEXTS: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  402: 'Payment Required',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  406: 'Not Acceptable',
  408: 'Request Timeout',
  409: 'Conflict',
  410: 'Gone',
  412: 'Precondition Failed',
  413: 'Content Too Large',
  415: 'Unsupported Media Type',
  418: "I'm a teapot",
  419: 'Page Expired',
  422: 'Unprocessable Content',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  501: 'Not Implemented',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

export function httpStatusText(status: number): string {
  return STATUS_TEXTS[status] ?? (status >= 500 ? 'Internal Server Error' : 'Error');
}
