import type { Response } from '../Response';
import { ResponseObject } from './ResponseObject';

/**
 * JsonResponse - a response object carrying a JSON-serialisable payload
 * Laravel: Illuminate\Http\JsonResponse
 *
 * Return it from a controller or middleware instead of calling res.json()
 * directly; the framework serialises it onto the transport when delivered.
 */
export class JsonResponse extends ResponseObject {
  /**
   * The payload to serialise
   */
  public data: any;

  constructor(data: any, status: number = 200, headers: Record<string, string> = {}) {
    super(null, status, { 'Content-Type': 'application/json', ...headers });
    this.data = data;
  }

  /**
   * Replace the payload
   * Laravel: $response->setData()
   */
  setData(data: any): this {
    this.data = data;
    return this;
  }

  /**
   * The JSON string this response would write
   */
  encoded(): string {
    return JSON.stringify(this.data);
  }

  override async sendTo(response: Response): Promise<void> {
    if (response.finished) {
      return;
    }

    response.status(this.status);
    response.headers(this.headers);
    response.json(this.data);
  }
}
