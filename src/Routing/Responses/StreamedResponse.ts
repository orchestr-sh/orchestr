import type { ServerResponse } from 'http';
import type { Response } from '../Response';
import { ResponseObject } from './ResponseObject';

/**
 * The streaming callback receives the Node ServerResponse; chunks written to
 * it arrive as they are produced instead of being buffered in memory.
 * Laravel: the callback passed to response()->stream()
 */
export type StreamCallback = (stream: ServerResponse) => void | Promise<void>;

/**
 * StreamedResponse - a response object that streams its body through a
 * callback once the framework has written the status and headers
 * Laravel: Symfony\Component\HttpFoundation\StreamedResponse
 */
export class StreamedResponse extends ResponseObject {
  /**
   * The callback that writes the body
   */
  public callback: StreamCallback;

  constructor(callback: StreamCallback, status: number = 200, headers: Record<string, string> = {}) {
    super(null, status, { 'Content-Type': 'text/html; charset=UTF-8', ...headers });
    this.callback = callback;
  }

  override async sendTo(response: Response): Promise<void> {
    if (response.finished) {
      return;
    }

    const stream = response.raw;

    // Claim the transport before streaming: a callback that throws midway
    // must not make the exception handler try to render over partial output
    response.finished = true;

    stream.statusCode = this.status;

    for (const [name, value] of Object.entries(this.headers)) {
      stream.setHeader(name, value);
    }

    try {
      await this.callback(stream);
    } finally {
      if (!stream.writableEnded) {
        stream.end();
      }
    }
  }
}
