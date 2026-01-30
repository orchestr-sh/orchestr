import { ServerResponse } from 'http';

/**
 * Response - Laravel's HTTP Response wrapper
 * Illuminate\Http\Response
 */
export class Response {
  public raw: ServerResponse;
  public finished: boolean = false;
  private statusCode: number = 200;
  private responseHeaders: Record<string, string> = {};
  private cookies: Array<{ name: string; value: string; options: CookieOptions }> = [];

  constructor(res: ServerResponse) {
    this.raw = res;
  }

  /**
   * Set the response status code
   * Laravel: response()->status(404)
   */
  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  /**
   * Set a header on the response
   * Laravel: response()->header('Content-Type', 'application/json')
   */
  header(name: string, value: string): this {
    this.responseHeaders[name] = value;
    return this;
  }

  /**
   * Set multiple headers
   */
  headers(headers: Record<string, string>): this {
    Object.assign(this.responseHeaders, headers);
    return this;
  }

  /**
   * Set a cookie on the response
   * Laravel: response()->cookie('name', 'value')
   */
  cookie(name: string, value: string, options: CookieOptions = {}): this {
    this.cookies.push({ name, value, options });
    return this;
  }

  /**
   * Write headers to the response
   */
  private writeHeaders(): void {
    this.raw.statusCode = this.statusCode;

    // Write custom headers
    for (const [name, value] of Object.entries(this.responseHeaders)) {
      this.raw.setHeader(name, value);
    }

    // Write cookies
    if (this.cookies.length > 0) {
      const cookieHeaders = this.cookies.map(({ name, value, options }) => {
        return this.serializeCookie(name, value, options);
      });

      this.raw.setHeader('Set-Cookie', cookieHeaders);
    }
  }

  /**
   * Send a response
   * Laravel: response('Hello World')
   */
  send(data: any): void {
    if (this.finished) {
      return;
    }

    this.writeHeaders();

    if (data === null || data === undefined) {
      this.raw.end();
    } else if (typeof data === 'string' || Buffer.isBuffer(data)) {
      this.raw.end(data);
    } else if (typeof data === 'object') {
      this.json(data);
      return;
    } else {
      this.raw.end(String(data));
    }

    this.finished = true;
  }

  /**
   * Send a JSON response
   * Laravel: response()->json(['key' => 'value'])
   */
  json(data: any, statusCode?: number): void {
    if (this.finished) {
      return;
    }

    if (statusCode) {
      this.statusCode = statusCode;
    }

    this.header('Content-Type', 'application/json');
    this.writeHeaders();

    this.raw.end(JSON.stringify(data));
    this.finished = true;
  }

  /**
   * Send a redirect response
   * Laravel: redirect('/path')
   */
  redirect(url: string, statusCode: number = 302): void {
    if (this.finished) {
      return;
    }

    this.statusCode = statusCode;
    this.header('Location', url);
    this.writeHeaders();

    this.raw.end();
    this.finished = true;
  }

  /**
   * Send a download response
   * Laravel: response()->download($path)
   */
  download(data: Buffer | string, filename: string): void {
    if (this.finished) {
      return;
    }

    this.header('Content-Disposition', `attachment; filename="${filename}"`);
    this.header('Content-Type', 'application/octet-stream');
    this.send(data);
  }

  /**
   * Send a view response (simplified)
   * Laravel: view('welcome', ['name' => 'John'])
   */
  view(template: string, data: Record<string, any> = {}): void {
    // This would normally render a template
    // For now, just send a basic HTML response
    this.header('Content-Type', 'text/html');
    this.send(`<html><body><h1>View: ${template}</h1><pre>${JSON.stringify(data, null, 2)}</pre></body></html>`);
  }

  /**
   * Serialize a cookie
   */
  private serializeCookie(name: string, value: string, options: CookieOptions): string {
    let cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}`;

    if (options.maxAge) {
      cookie += `; Max-Age=${options.maxAge}`;
    }

    if (options.domain) {
      cookie += `; Domain=${options.domain}`;
    }

    if (options.path) {
      cookie += `; Path=${options.path}`;
    } else {
      cookie += '; Path=/';
    }

    if (options.expires) {
      cookie += `; Expires=${options.expires.toUTCString()}`;
    }

    if (options.httpOnly) {
      cookie += '; HttpOnly';
    }

    if (options.secure) {
      cookie += '; Secure';
    }

    if (options.sameSite) {
      cookie += `; SameSite=${options.sameSite}`;
    }

    return cookie;
  }
}

/**
 * Cookie options
 */
export interface CookieOptions {
  maxAge?: number;
  domain?: string;
  path?: string;
  expires?: Date;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}
