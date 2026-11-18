/**
 * Shared helpers for the HTTP client test suites: a loopback http server
 * that records every inbound request (method, url, headers, raw body) and
 * answers through a swappable responder function. Tests drive the default
 * FetchTransport against it - no internet access, and no fake shortcuts.
 */

import type { AddressInfo } from 'node:net';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

/**
 * One captured inbound request
 */
export interface ServedRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/**
 * A responder decides how the server answers request number `index`.
 */
export type Responder = (request: ServedRequest, res: ServerResponse, index: number) => void;

export class HttpTestServer {
  public readonly requests: ServedRequest[] = [];

  /**
   * The active responder; defaults to echoing the request back as JSON.
   */
  public responder: Responder = echo;

  private server: Server | null = null;

  private baseUrl: string = '';

  async start(): Promise<void> {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];

      req.on('data', (chunk) => chunks.push(chunk as Buffer));

      req.on('end', () => {
        const recorded: ServedRequest = {
          method: req.method ?? 'GET',
          url: req.url ?? '',
          headers: { ...req.headers },
          body: Buffer.concat(chunks).toString('utf8'),
        };

        this.requests.push(recorded);

        this.responder(recorded, res, this.requests.length - 1);
      });
    });

    this.server = server;

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });

    this.baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    const server = this.server;

    if (!server) {
      return;
    }

    this.server = null;

    // Connections the client is still holding (hung responders included).
    server.closeAllConnections();

    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  /**
   * Absolute URL on this server.
   */
  url(path: string = '/'): string {
    return `${this.baseUrl}${path}`;
  }

  /**
   * The most recently captured request.
   */
  lastRequest(): ServedRequest {
    return this.requests[this.requests.length - 1];
  }
}

/**
 * Default responder: echo the request back as JSON.
 */
export const echo: Responder = (request, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ method: request.method, url: request.url, body: request.body }));
};

/**
 * Responder factory: always answer with the given status/body/headers.
 */
export function reply(body: any = '', status: number = 200, headers: Record<string, string> = {}): Responder {
  return (_request, res) => {
    res.writeHead(status, { 'Content-Type': 'text/plain', ...headers });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };
}
