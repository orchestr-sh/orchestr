import type { Response } from '../Response';
import { ResponseObject } from './ResponseObject';

/**
 * RedirectResponse - a response object that moves the client to another URL
 * Laravel: Illuminate\Http\RedirectResponse
 *
 * Return it from a controller or middleware instead of calling res.redirect()
 * directly.
 */
export class RedirectResponse extends ResponseObject {
  /**
   * The destination URL carried in the Location header
   */
  public url: string;

  constructor(url: string, status: number = 302, headers: Record<string, string> = {}) {
    super(null, status, { Location: url, ...headers });
    this.url = url;
  }

  /**
   * Change the destination, keeping the Location header in sync
   */
  setUrl(url: string): this {
    this.url = url;
    this.headers.Location = url;
    return this;
  }

  override async sendTo(response: Response): Promise<void> {
    if (response.finished) {
      return;
    }

    response.status(this.status);
    response.headers(this.headers);
    response.redirect(this.url, this.status);
  }
}
