import type { Request } from '@/Routing/Request';
import type { ResponseObject } from '@/Routing/Responses/ResponseObject';

/**
 * The exception prepared for rendering: everything a renderer needs, decided
 * once by the Handler so renderers stay transport- and type-agnostic.
 */
export interface ExceptionDetails {
  /** The HTTP status code to respond with */
  status: number;
  /** The message shown to the client */
  message: string;
  /** Headers carried onto the response (e.g. HttpException's custom headers) */
  headers: Record<string, string>;
  /** The validation error bag, present only for ValidationException */
  errors?: Record<string, string[]>;
  /** The original exception, used for debug rendering */
  exception: Error;
  /** Whether debug output (stack traces) is allowed */
  debug: boolean;
}

/**
 * A rendering strategy the Handler consults in registration order; the first
 * renderer whose supports() matches the request produces the response.
 *
 * Adding a format means implementing this interface and registering it with
 * Handler.addRenderer() - never editing the Handler itself (OCP).
 */
export interface ExceptionRenderer {
  /** Determine if this renderer should answer the given request */
  supports(request: Request): boolean;

  /** Render the normalized exception into a response object */
  render(request: Request, details: ExceptionDetails): ResponseObject;
}
