/**
 * Cursor
 *
 * The position a cursor page starts from, mirroring
 * Illuminate\Pagination\Cursor. A cursor encodes the ordered column values of
 * the item it points at together with the query's ordering, so the next page
 * can rebuild the "rows after this point" condition from the index alone.
 */

/**
 * The directions a cursor's ordered columns run in
 */
export type CursorDirection = 'asc' | 'desc';

/**
 * Whether a cursor page moves forward from its point or back towards the
 * start
 */
export type CursorTravel = 'forward' | 'back';

/**
 * Raised when an encoded cursor is not a well-formed cursor at all
 * Laravel: InvalidCursorException
 */
export class InvalidCursorException extends Error {
  constructor(encoded: string) {
    super(`The pagination cursor [${encoded}] is invalid.`);
    this.name = 'InvalidCursorException';
  }
}

export class Cursor {
  constructor(
    /**
     * The ordered column values this point sits on
     */
    public readonly parameters: Record<string, any>,
    /**
     * The ordering the pagination runs on: column to direction
     */
    public readonly index: Record<string, CursorDirection>,
    /**
     * Which way a page built from this cursor travels
     */
    public readonly options: { travel?: CursorTravel } = {}
  ) {}

  /**
   * Whether this cursor asks for the page *before* its point
   */
  isBackward(): boolean {
    return this.options.travel === 'back';
  }

  /**
   * The same cursor travelling the other way - what previous-page links carry
   */
  reversed(): Cursor {
    return new Cursor(this.parameters, this.index, {
      ...this.options,
      travel: this.isBackward() ? 'forward' : 'back',
    });
  }

  /**
   * Encode the cursor for a URL: base64url JSON, so it survives query
   * strings untouched
   * Laravel: Cursor::encode()/toEncoded()
   */
  toEncoded(): string {
    return Buffer.from(
      JSON.stringify({ parameters: this.parameters, index: this.index, options: this.options })
    ).toString('base64url');
  }

  /**
   * Decode a cursor handed back by a client
   * Laravel: Cursor::fromEncoded()
   */
  static fromEncoded(encoded: string): Cursor {
    let decoded: any;

    try {
      decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    } catch {
      throw new InvalidCursorException(encoded);
    }

    if (
      decoded === null ||
      typeof decoded !== 'object' ||
      typeof decoded.parameters !== 'object' ||
      decoded.parameters === null ||
      typeof decoded.index !== 'object' ||
      decoded.index === null
    ) {
      throw new InvalidCursorException(encoded);
    }

    return new Cursor(decoded.parameters, decoded.index, decoded.options ?? {});
  }

  /**
   * Alias for `fromEncoded`, the Laravel spelling
   */
  static decode(encoded: string): Cursor {
    return Cursor.fromEncoded(encoded);
  }

  /**
   * Alias for `toEncoded`, the Laravel spelling
   */
  encode(): string {
    return this.toEncoded();
  }
}
