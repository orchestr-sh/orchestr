import { IncomingMessage, ServerResponse } from 'http';
import { Socket } from 'net';
import { Application } from '@/Foundation/Application';
import { Kernel } from '@/Foundation/Http/Kernel';
import { Router } from '@/Routing/Router';

/**
 * Raw request with an optional buffered body, mirroring how the
 * middleware-pipeline tests build IncomingMessage instances. Pushing the
 * body before the Kernel attaches listeners keeps it buffered until
 * parseBody() flows it. Header names are lowercased like Node's http
 * layer does for real incoming requests.
 */
export function createRawRequest(
  method: string,
  url: string,
  options: { headers?: Record<string, string>; body?: string } = {}
): IncomingMessage {
  const req = new IncomingMessage(new Socket());
  req.method = method;
  req.url = url;
  req.headers = {};

  for (const [name, value] of Object.entries(options.headers ?? {})) {
    req.headers[name.toLowerCase()] = value;
  }

  if (options.body !== undefined) {
    req.push(Buffer.from(options.body));
  }

  req.push(null);

  return req;
}

/**
 * ServerResponse double that records the chunks and headers a Response
 * writes, including individual Set-Cookie entries
 */
export function captureResponse(): {
  raw: ServerResponse;
  chunks: string[];
  headers: Record<string, string>;
  cookies: string[];
} {
  const raw = new ServerResponse(new IncomingMessage(new Socket()));
  const chunks: string[] = [];
  const headers: Record<string, string> = {};
  const cookies: string[] = [];

  raw.end = ((data?: any) => {
    if (data !== undefined && data !== null) {
      chunks.push(String(data));
    }
  }) as any;

  raw.setHeader = ((name: string, value: any) => {
    if (name.toLowerCase() === 'set-cookie') {
      cookies.push(...(Array.isArray(value) ? value.map(String) : [String(value)]));
    }

    headers[name] = Array.isArray(value) ? value.join(', ') : String(value);
  }) as any;

  return { raw, chunks, headers, cookies };
}

export interface Captured {
  status: number;
  body: string;
  headers: Record<string, string>;
  cookies: string[];
}

/**
 * Drive a full Kernel.handle() round trip and capture what was sent
 */
export async function handle(
  kernel: Kernel,
  method: string,
  url: string,
  options: { headers?: Record<string, string>; body?: string } = {}
): Promise<Captured> {
  const { raw, chunks, headers, cookies } = captureResponse();

  await kernel.handle(createRawRequest(method, url, options), raw);

  return { status: raw.statusCode, body: chunks.join(''), headers, cookies };
}

/**
 * Extract a cookie's decoded value from captured Set-Cookie headers
 */
export function cookieValue(cookies: string[], name: string): string | undefined {
  const entry = cookies.find((cookie) => cookie.startsWith(`${name}=`));

  if (!entry) {
    return undefined;
  }

  return decodeURIComponent(entry.slice(name.length + 1).split(';')[0]);
}

/**
 * The full Set-Cookie attribute string for a cookie name
 */
export function cookieHeader(cookies: string[], name: string): string | undefined {
  return cookies.find((cookie) => cookie.startsWith(`${name}=`));
}

/**
 * Build an application + router + kernel triple for HTTP-level tests
 */
export function createApp(): { app: Application; router: Router; kernel: Kernel } {
  const app = new Application('/test');
  const router = new Router(app);
  app.singleton('router', () => router);
  const kernel = new Kernel(app);

  return { app, router, kernel };
}
