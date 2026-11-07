import type { Request } from '@/Routing/Request';
import { ResponseObject } from '@/Routing/Responses/ResponseObject';
import type { ExceptionDetails, ExceptionRenderer } from './Renderer';
import { httpStatusText } from './HttpException';

/**
 * HtmlRenderer - renders exceptions as standalone HTML error pages
 * Laravel: Illuminate\Foundation\Exceptions\Handler::renderHttpException()
 * (the framework's error pages; Whoops provides the debug variant)
 *
 * Selected when the client accepts HTML. Debug mode adds the exception
 * details and stack trace; production renders the status, its reason phrase
 * and the exception's own (developer-authored) message only.
 */
export class HtmlRenderer implements ExceptionRenderer {
  supports(request: Request): boolean {
    return request.acceptsHtml();
  }

  render(_request: Request, details: ExceptionDetails): ResponseObject {
    const title = `${details.status} ${httpStatusText(details.status)}`;

    const sections = [`<h1>${escapeHtml(title)}</h1>`, `<p>${escapeHtml(details.message)}</p>`];

    if (details.errors) {
      const lists = Object.entries(details.errors)
        .map(
          ([field, messages]) =>
            `<dt>${escapeHtml(field)}</dt><dd><ul>${messages
              .map((message) => `<li>${escapeHtml(message)}</li>`)
              .join('')}</ul></dd>`
        )
        .join('');

      sections.push(`<dl class="errors">${lists}</dl>`);
    }

    if (details.debug) {
      sections.push(
        `<pre class="trace">${escapeHtml(`${details.exception.name}: ${details.exception.message}\n${details.exception.stack ?? ''}`)}</pre>`
      );
    }

    const html = [
      '<!DOCTYPE html>',
      `<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>`,
      '<style>body{font-family:system-ui,sans-serif;margin:2rem auto;max-width:48rem;padding:0 1rem}',
      'h1{font-size:1.5rem}pre{background:#f4f4f5;padding:1rem;overflow:auto;white-space:pre-wrap}',
      'dl.errors dd{margin:0 0 .5rem 1rem}</style></head>',
      `<body>${sections.join('')}</body></html>`,
    ].join('');

    return new ResponseObject(html, details.status, { 'Content-Type': 'text/html', ...details.headers });
  }
}

/**
 * Escape text for embedding in the error page HTML
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
