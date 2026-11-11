/**
 * Multipart form-data parser
 *
 * A focused internal parser behind Request::parseBody(): it walks the
 * buffered body for boundary-delimited parts, decodes text fields and
 * turns file parts into UploadedFile instances. Memory limits are
 * preserved - buffering for a part stops once it crosses the configured
 * per-file ceiling, and oversized files surface as UPLOAD_ERR_INI_SIZE
 * uploads instead of exhausting the heap.
 */

import { FileUploadException } from './FileUploadException';
import { UploadedFile, UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_OK } from './UploadedFile';

/**
 * 2 MiB, the default upload ceiling (PHP's upload_max_filesize default)
 */
export const DEFAULT_MAX_FILE_SIZE = 2 * 1024 * 1024;

/**
 * 16 MiB, the default ceiling for an entire multipart body
 */
export const DEFAULT_MAX_BODY_SIZE = 16 * 1024 * 1024;

export interface MultipartLimits {
  /** Maximum bytes a single file part may hold */
  maxFileSize?: number;
  /** Maximum bytes the whole body may hold */
  maxBodySize?: number;
}

/**
 * A multipart body's text fields and uploaded files
 */
export interface MultipartResult {
  fields: Record<string, any>;
  files: Record<string, UploadedFile | UploadedFile[]>;
}

/**
 * Extract the boundary parameter from a multipart/form-data Content-Type
 * header, quoted or bare
 */
export function multipartBoundary(contentType: string): string | null {
  const match = /boundary=(?:"([^"]*)"|([^;\s]*))/i.exec(contentType);

  if (!match) {
    return null;
  }

  const boundary = match[1] ?? match[2] ?? '';

  return boundary === '' ? null : boundary;
}

/**
 * Parse a multipart/form-data body into its fields and file uploads
 */
export function parseMultipart(body: Buffer, boundary: string, limits: MultipartLimits = {}): MultipartResult {
  const maxFileSize = limits.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
  const maxBodySize = limits.maxBodySize ?? DEFAULT_MAX_BODY_SIZE;

  if (body.byteLength > maxBodySize) {
    throw new FileUploadException(`Multipart body of ${body.byteLength} bytes exceeds the ${maxBodySize} byte limit.`);
  }

  const fields: Record<string, any> = {};
  const files: Record<string, UploadedFile | UploadedFile[]> = {};

  const delimiter = Buffer.from(`--${boundary}`);

  // Delimiters only count at line starts; content that merely contains the
  // boundary text mid-line stays part of the data
  const starts = findDelimiters(body, delimiter);

  if (starts.length === 0) {
    throw new FileUploadException('Multipart body does not contain its boundary delimiter.');
  }

  for (let index = 0; index < starts.length; index++) {
    const start = starts[index];
    const after = start + delimiter.byteLength;

    // The closing delimiter "--" ends the body; its epilogue is ignored
    if (body[after] === 0x2d && body[after + 1] === 0x2d) {
      break;
    }

    // Skip transport padding and the newline that follows the delimiter
    let cursor = after;

    while (cursor < body.byteLength && (body[cursor] === 0x20 || body[cursor] === 0x09)) {
      cursor++;
    }

    if (body[cursor] === 0x0d && body[cursor + 1] === 0x0a) {
      cursor += 2;
    } else if (body[cursor] === 0x0a) {
      cursor += 1;
    } else {
      continue; // Not a real delimiter occurrence after all
    }

    const rawEnd = index + 1 < starts.length ? starts[index + 1] : body.byteLength;

    // Strip the CRLF that belongs to the next delimiter line
    let end = rawEnd;

    if (body[end - 1] === 0x0a) {
      end -= body[end - 2] === 0x0d ? 2 : 1;
    }

    if (end <= cursor) {
      continue;
    }

    const part = body.subarray(cursor, end);
    const headerEnd = part.indexOf('\r\n\r\n');
    const headerSplit = headerEnd === -1 ? part.indexOf('\n\n') : headerEnd;

    if (headerSplit === -1) {
      continue;
    }

    const headers = parsePartHeaders(part.subarray(0, headerSplit).toString('utf-8'));
    const data = part.subarray(headerSplit + (headerEnd === -1 ? 2 : 4));

    const disposition = parseContentDisposition(headers['content-disposition'] ?? '');
    const type = headers['content-type']?.split(';')[0].trim().toLowerCase();

    if (disposition.name === null) {
      continue;
    }

    if (disposition.filename === null) {
      assign(fields, disposition.name, data.toString('utf-8'));
      continue;
    }

    // An empty filename means the browser submitted no file at all
    if (disposition.filename === '') {
      continue;
    }

    const tooLarge = data.byteLength > maxFileSize;

    assign(
      files,
      disposition.name,
      new UploadedFile({
        name: disposition.filename,
        // Memory limit: oversized parts are rejected outright and never
        // buffered beyond the ceiling
        contents: tooLarge ? null : Buffer.from(data),
        mimeType: type || null,
        error: tooLarge ? UPLOAD_ERR_INI_SIZE : UPLOAD_ERR_OK,
      })
    );
  }

  return { fields, files };
}

/**
 * Byte offsets at which `delimiter` begins a line
 */
function findDelimiters(body: Buffer, delimiter: Buffer): number[] {
  const starts: number[] = [];
  let cursor = 0;

  for (;;) {
    const index = body.indexOf(delimiter, cursor);

    if (index === -1) {
      break;
    }

    const atLineStart = index === 0 || body[index - 1] === 0x0a;

    if (atLineStart) {
      starts.push(index);
      cursor = index + delimiter.byteLength;
    } else {
      cursor = index + 1;
    }
  }

  return starts;
}

/**
 * Part headers, lower-cased and first-value-per-name
 */
function parsePartHeaders(block: string): Record<string, string> {
  const headers: Record<string, string> = {};

  for (const line of block.split(/\r?\n/)) {
    const separator = line.indexOf(':');

    if (separator === -1) {
      continue;
    }

    const name = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (!(name in headers)) {
      headers[name] = value;
    }
  }

  return headers;
}

/**
 * Content-Disposition name and filename parameters, quoted or bare, with
 * RFC 5987 `filename*` (charset''percent-encoded) support
 */
function parseContentDisposition(header: string): { name: string | null; filename: string | null } {
  const name = readParameter(header, 'name');
  let filename = readParameter(header, 'filename');

  if (filename === null) {
    const extended = readParameter(header, 'filename\\*');

    filename = extended === null ? null : decodeRfc5987(extended);
  }

  return { name, filename };
}

function readParameter(header: string, key: string): string | null {
  const pattern = new RegExp(`;\\s*${key}=(?:"((?:\\\\.|[^"\\\\])*)"|([^;]*))`, 'i');
  const match = pattern.exec(header);

  if (!match) {
    return null;
  }

  const raw = match[1] ?? match[2] ?? '';

  return raw.replace(/\\(.)/g, '$1').trim();
}

function decodeRfc5987(value: string): string {
  const quote = value.lastIndexOf("'");
  const encoded = quote === -1 ? value : value.slice(quote + 1);

  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

/**
 * Assign a (possibly bracketed) input name into its bag: `photos[]`
 * appends to an array, `user[first]` nests, plain names set directly -
 * the way PHP's form submission semantics fill $_POST / $_FILES
 */
function assign(bag: Record<string, any>, name: string, value: any): void {
  const segments = splitName(name);

  if (segments.length === 0) {
    return;
  }

  let current: any = bag;

  for (let index = 0; index < segments.length - 1; index++) {
    const segment = segments[index];

    if (segment === null) {
      // `[].key` after an array marker is not something browsers emit;
      // ignore the rest rather than invent a shape
      return;
    }

    if (current[segment] === undefined || typeof current[segment] !== 'object') {
      current[segment] = segments[index + 1] === null ? [] : {};
    }

    current = current[segment];
  }

  const last = segments[segments.length - 1];

  if (last === null) {
    if (!Array.isArray(current)) {
      return;
    }

    current.push(value);
    return;
  }

  if (Array.isArray(current)) {
    current.push(value);
    return;
  }

  current[last] = value;
}

/**
 * 'photos[]' -> ['photos', null]; 'user[first]' -> ['user', 'first']
 */
function splitName(name: string): Array<string | null> {
  const head = /^[^[\]]+/.exec(name);
  const segments: Array<string | null> = head ? [head[0]] : [];
  const bracket = /\[([^\]]*)\]/g;
  let match: RegExpExecArray | null;

  while ((match = bracket.exec(name)) !== null) {
    segments.push(match[1] === '' ? null : match[1]);
  }

  return segments;
}
