import type { Response } from '../Response';

/**
 * ResponseObject - a transport-independent HTTP response that controllers,
 * middleware and the exception handler return; the framework writes it onto
 * the Node ServerResponse through the Response writer when it arrives.
 *
 * Laravel: Illuminate\Http\Response instances built in controllers and sent
 * by the framework, rather than echoing directly onto the SAPI.
 *
 * The base class carries a literal body; JsonResponse, RedirectResponse and
 * StreamedResponse specialise it.
 */
export class ResponseObject {
  /**
   * The HTTP status code to respond with
   */
  public status: number;

  /**
   * Headers merged into the response
   */
  public headers: Record<string, string>;

  /**
   * The response body; null means "no content"
   */
  public content: string | null;

  constructor(content: string | null = null, status: number = 200, headers: Record<string, string> = {}) {
    this.content = content;
    this.status = status;
    this.headers = { ...headers };
  }

  /**
   * Set the status code
   * Laravel: $response->setStatusCode()
   */
  withStatus(status: number): this {
    this.status = status;
    return this;
  }

  /**
   * Set a single header
   * Laravel: $response->header()
   */
  withHeader(name: string, value: string): this {
    this.headers[name] = value;
    return this;
  }

  /**
   * Merge multiple headers
   */
  withHeaders(headers: Record<string, string>): this {
    Object.assign(this.headers, headers);
    return this;
  }

  /**
   * Write this response onto the Response's transport
   */
  async sendTo(response: Response): Promise<void> {
    if (response.finished) {
      return;
    }

    response.status(this.status);
    response.headers(this.headers);
    response.send(this.content);
  }
}
