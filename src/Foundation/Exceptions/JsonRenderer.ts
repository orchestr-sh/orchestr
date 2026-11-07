import type { Request } from '@/Routing/Request';
import type { ResponseObject } from '@/Routing/Responses/ResponseObject';
import { JsonResponse } from '@/Routing/Responses/JsonResponse';
import type { ExceptionDetails, ExceptionRenderer } from './Renderer';

/**
 * Route prefixes whose errors are always JSON, even for browser requests -
 * the way Laravel's api middleware stack forces JSON on API routes
 */
const API_PREFIXES: string[] = ['api'];

/**
 * JsonRenderer - renders exceptions as `{ message, errors? }` JSON bodies
 * Laravel: Illuminate\Foundation\Exceptions\Handler::jsonResponse()
 *
 * Selected when the request expects JSON (Accept: application/json or an
 * AJAX call) or is served under an API route prefix. In debug mode the stack
 * is appended, mirroring the JSON debug output the framework produced before.
 */
export class JsonRenderer implements ExceptionRenderer {
  supports(request: Request): boolean {
    return request.expectsJson() || JsonRenderer.isApiRequest(request);
  }

  render(_request: Request, details: ExceptionDetails): ResponseObject {
    const body: Record<string, any> = { message: details.message };

    if (details.errors) {
      body.errors = details.errors;
    }

    if (details.debug) {
      body.stack = details.exception.stack;
    }

    return new JsonResponse(body, details.status, details.headers);
  }

  /**
   * Determine whether the matched route (or the request path while nothing
   * has matched yet) lives under an API prefix
   */
  static isApiRequest(request: Request): boolean {
    const uri = request.route()?.uri ?? request.getPath();
    const firstSegment = uri.replace(/^\/+/, '').split('/')[0];

    return API_PREFIXES.includes(firstSegment);
  }
}
