/**
 * ExpressionEvaluator - Safe expression language for view templates.
 *
 * This module is the **sandbox boundary** for the Blade-compatible compiler.
 * Templates never reach `eval` or `new Function`; every expression inside
 * `{{ }}`, `@if(...)`, `@for(...)` and friends is parsed by the tokenizer /
 * recursive-descent parser below and walked by an interpreter whose only
 * capabilities are:
 *
 *   - reading and assigning plain identifiers on the view data scope
 *     (a null-prototype chain, so `constructor`, `__proto__`, globals etc.
 *     are unreachable),
 *   - property access, indexing and calls on *values that were handed to
 *     the view* (functions in the data are trusted: they came from the
 *     application, not from the template),
 *   - a fixed whitelist of pure helper functions (`count`, `implode`,
 *     `number_format`, ...).
 *
 * Supported syntax: literals (number, single/double-quoted string),
 * identifiers (with an optional leading `$` for Blade familiarity),
 * member/index access, optional chaining `?.`, non-null assertions are not
 * provided, calls with spread, array/object literals, unary `! - +`,
 * `++/--` (prefix and postfix), the binary operators
 * `** * / % + - < <= > >= == != === !== in "not in" && || ??` and the
 * ternary `? :`. Assignment (`= += -= *= /= %= &&= ||= ??=`) is allowed
 * where the left-hand side is an identifier or member path.
 *
 * Mirrors the expression subset Laravel's Blade exposes to PHP in views,
 * minus arbitrary code execution.
 */

/** Raised for malformed expressions and unsafe/sandboxed operations. */
export class ExpressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExpressionError';
  }
}

/** Raised when an identifier is not present on the view data scope. */
export class UndefinedVariableError extends ExpressionError {
  constructor(public variable: string) {
    super(`Undefined variable [${variable}]`);
    this.name = 'UndefinedVariableError';
  }
}

/**
 * A view data scope. Scopes are null-prototype objects chained with
 * Object.create so loop bodies can shadow variables without leaking them,
 * while assignments bubble up to the defining level (like PHP variables).
 */
export type Scope = Record<string, unknown>;

/** Create the root scope for a set of view data. */
export function createScope(data: Record<string, unknown> = {}): Scope {
  const scope: Scope = Object.create(null);
  Object.assign(scope, data);
  return scope;
}

/** Derive a child scope (loop iteration, include, component, ...). */
export function childScope(parent: Scope, extra: Record<string, unknown> = {}): Scope {
  const scope: Scope = Object.create(parent);
  Object.assign(scope, extra);
  return scope;
}

/**
 * Assign a variable, walking the prototype chain to the object that already
 * owns the name; brand-new names land on the root scope so that - as in PHP
 * - a variable created inside a loop outlives the iteration.
 */
export function assignScope(scope: Scope, name: string, value: unknown): void {
  let owner: Scope | null = scope;
  let root: Scope = scope;

  while (owner) {
    if (Object.prototype.hasOwnProperty.call(owner, name)) {
      owner[name] = value;
      return;
    }
    root = owner;
    owner = Object.getPrototypeOf(owner) as Scope | null;
  }

  root[name] = value;
}

/** Look up an identifier anywhere on the chain; throws when missing. */
export function resolveScope(scope: Scope, name: string): unknown {
  if (name in scope) {
    return (scope as Record<string, unknown>)[name];
  }
  throw new UndefinedVariableError(name);
}

// ---------------------------------------------------------------------------
// Expression AST
// ---------------------------------------------------------------------------

type Expr =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'bool'; v: boolean }
  | { k: 'null' }
  | { k: 'undef' }
  | { k: 'ident'; name: string }
  | { k: 'member'; obj: Expr; prop: string; optional: boolean }
  | { k: 'index'; obj: Expr; index: Expr; optional: boolean }
  | { k: 'call'; fn: Expr; args: ArgExpr[]; optional: boolean }
  | { k: 'array'; items: ArgExpr[] }
  | { k: 'pair'; key: Expr; value: Expr }
  | { k: 'object'; props: Array<{ key: string; value: Expr }> }
  | { k: 'unary'; op: string; operand: Expr }
  | { k: 'update'; op: '++' | '--'; operand: Expr; prefix: boolean }
  | { k: 'binary'; op: string; left: Expr; right: Expr }
  | { k: 'logical'; op: '&&' | '||' | '??'; left: Expr; right: Expr }
  | { k: 'ternary'; test: Expr; cons: Expr; alt: Expr }
  | { k: 'assign'; op: string; target: Expr; value: Expr };

type ArgExpr = { expr: Expr; spread: boolean };

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

interface Token {
  t: 'num' | 'str' | 'name' | 'op';
  v: string;
  n?: number;
}

const OPERATORS = [
  '===',
  '!==',
  '**',
  '?->',
  '?.',
  '->',
  '??=',
  '||=',
  '&&=',
  '...',
  '==',
  '!=',
  '<=',
  '>=',
  '&&',
  '||',
  '??',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '++',
  '--',
  '=>',
  '+',
  '-',
  '*',
  '/',
  '%',
  '<',
  '>',
  '!',
  '?',
  ':',
  '(',
  ')',
  '[',
  ']',
  '{',
  '}',
  ',',
  '.',
  '=',
];

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  const isIdentStart = (c: string) => /[A-Za-z_$]/.test(c);
  const isIdentPart = (c: string) => /[A-Za-z0-9_$]/.test(c);

  while (i < src.length) {
    const c = src[i];

    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
      continue;
    }

    // Numbers: 123, 1.5, .5, 1e3, 0x1f
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^(0[xX][0-9a-fA-F]+|(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?)/.exec(src.slice(i));
      if (!m) {
        throw new ExpressionError(`Malformed number at offset ${i}`);
      }
      tokens.push({ t: 'num', v: m[1], n: Number(m[1]) });
      i += m[1].length;
      continue;
    }

    // Strings
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      let out = '';
      i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\' && i + 1 < src.length) {
          const next = src[i + 1];
          const map: Record<string, string> = {
            n: '\n',
            t: '\t',
            r: '\r',
            '\\': '\\',
            "'": "'",
            '"': '"',
            '`': '`',
            '0': '\0',
          };
          out += map[next] ?? next;
          i += 2;
          continue;
        }
        out += src[i++];
      }
      if (i >= src.length) {
        throw new ExpressionError('Unterminated string literal');
      }
      i++; // closing quote
      tokens.push({ t: 'str', v: out });
      continue;
    }

    // Identifiers / keywords (leading $ allowed, stripped on resolution)
    if (isIdentStart(c)) {
      let out = c;
      i++;
      while (i < src.length && isIdentPart(src[i])) {
        out += src[i++];
      }
      tokens.push({ t: 'name', v: out });
      continue;
    }

    let matched = false;
    for (const op of OPERATORS) {
      if (src.startsWith(op, i)) {
        tokens.push({ t: 'op', v: op });
        i += op.length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      throw new ExpressionError(`Unexpected character [${c}] at offset ${i}`);
    }
  }

  return tokens;
}

// ---------------------------------------------------------------------------
// Parser (recursive descent)
// ---------------------------------------------------------------------------

class ExprParser {
  private pos = 0;

  constructor(private tokens: Token[]) {}

  parse(): Expr {
    const node = this.parseAssignment();
    if (this.pos < this.tokens.length) {
      throw new ExpressionError(`Unexpected token [${this.peek()!.v}]`);
    }
    return node;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private next(): Token {
    const tok = this.tokens[this.pos++];
    if (!tok) {
      throw new ExpressionError('Unexpected end of expression');
    }
    return tok;
  }

  private isOp(...ops: string[]): boolean {
    const tok = this.peek();
    return !!tok && tok.t === 'op' && ops.includes(tok.v);
  }

  private eatOp(op: string): boolean {
    if (this.isOp(op)) {
      this.pos++;
      return true;
    }
    return false;
  }

  private isKeyword(word: string): boolean {
    const tok = this.peek();
    return !!tok && tok.t === 'name' && tok.v === word;
  }

  private parseAssignment(): Expr {
    const left = this.parseTernary();

    const assignOps = ['=', '+=', '-=', '*=', '/=', '%=', '??=', '||=', '&&='];
    const tok = this.peek();
    if (tok && tok.t === 'op' && assignOps.includes(tok.v)) {
      if (left.k !== 'ident' && left.k !== 'member' && left.k !== 'index') {
        throw new ExpressionError('Invalid assignment target');
      }
      this.pos++;
      const value = this.parseAssignment();
      return { k: 'assign', op: tok.v, target: left, value };
    }

    return left;
  }

  private parseTernary(): Expr {
    const test = this.parseNullish();

    if (this.eatOp('?')) {
      const cons = this.parseAssignment();
      if (!this.eatOp(':')) {
        throw new ExpressionError('Expected ":" in ternary expression');
      }
      const alt = this.parseAssignment();
      return { k: 'ternary', test, cons, alt };
    }

    return test;
  }

  private parseNullish(): Expr {
    let left = this.parseLogicalOr();
    while (this.isOp('??')) {
      this.pos++;
      left = { k: 'logical', op: '??', left, right: this.parseLogicalOr() };
    }
    return left;
  }

  private parseLogicalOr(): Expr {
    let left = this.parseLogicalAnd();
    while (this.isOp('||')) {
      this.pos++;
      left = { k: 'logical', op: '||', left, right: this.parseLogicalAnd() };
    }
    return left;
  }

  private parseLogicalAnd(): Expr {
    let left = this.parseEquality();
    while (this.isOp('&&')) {
      this.pos++;
      left = { k: 'logical', op: '&&', left, right: this.parseEquality() };
    }
    return left;
  }

  private parseEquality(): Expr {
    let left = this.parseComparison();
    while (this.isOp('==', '!=', '===', '!==')) {
      const op = this.next().v;
      left = { k: 'binary', op, left, right: this.parseComparison() };
    }
    return left;
  }

  private parseComparison(): Expr {
    let left = this.parseMembership();
    while (this.isOp('<', '>', '<=', '>=')) {
      const op = this.next().v;
      left = { k: 'binary', op, left, right: this.parseMembership() };
    }
    return left;
  }

  private parseMembership(): Expr {
    let left = this.parseAdditive();

    // `x in ys` / `x not in ys`
    if (this.isKeyword('in')) {
      this.pos++;
      left = { k: 'binary', op: 'in', left, right: this.parseAdditive() };
    } else if (this.isKeyword('not')) {
      const save = this.pos;
      this.pos++;
      if (this.isKeyword('in')) {
        this.pos++;
        left = { k: 'unary', op: '!', operand: { k: 'binary', op: 'in', left, right: this.parseAdditive() } };
      } else {
        this.pos = save;
      }
    }

    return left;
  }

  private parseAdditive(): Expr {
    let left = this.parseMultiplicative();
    while (this.isOp('+', '-')) {
      const op = this.next().v;
      left = { k: 'binary', op, left, right: this.parseMultiplicative() };
    }
    return left;
  }

  private parseMultiplicative(): Expr {
    let left = this.parseExponent();
    while (this.isOp('*', '/', '%')) {
      const op = this.next().v;
      left = { k: 'binary', op, left, right: this.parseExponent() };
    }
    return left;
  }

  private parseExponent(): Expr {
    const base = this.parseUnary();
    if (this.isOp('**')) {
      this.pos++;
      return { k: 'binary', op: '**', left: base, right: this.parseExponent() };
    }
    return base;
  }

  private parseUnary(): Expr {
    if (this.isOp('!', '-', '+')) {
      const op = this.next().v;
      return { k: 'unary', op, operand: this.parseUnary() };
    }
    if (this.isOp('++', '--')) {
      const op = this.next().v as '++' | '--';
      return { k: 'update', op, operand: this.parseUnary(), prefix: true };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): Expr {
    let expr = this.parsePrimary();

    for (;;) {
      if (this.isOp('.') || this.isOp('->')) {
        this.pos++;
        const nameTok = this.next();
        if (nameTok.t !== 'name') {
          throw new ExpressionError('Expected property name after "."');
        }
        expr = { k: 'member', obj: expr, prop: nameTok.v, optional: false };
      } else if (this.isOp('?.') || this.isOp('?->')) {
        this.pos++;
        if (this.isOp('(')) {
          this.pos++;
          expr = { k: 'call', fn: expr, args: this.parseArgs(), optional: true };
          continue;
        }
        const nameTok = this.next();
        if (nameTok.t !== 'name') {
          throw new ExpressionError('Expected property name after "?."');
        }
        expr = { k: 'member', obj: expr, prop: nameTok.v, optional: true };
      } else if (this.isOp('[')) {
        this.pos++;
        const index = this.parseAssignment();
        if (!this.eatOp(']')) {
          throw new ExpressionError('Expected "]"');
        }
        expr = { k: 'index', obj: expr, index, optional: false };
      } else if (this.isOp('(')) {
        this.pos++;
        expr = { k: 'call', fn: expr, args: this.parseArgs(), optional: false };
      } else if (this.isOp('++', '--')) {
        const op = this.next().v as '++' | '--';
        expr = { k: 'update', op, operand: expr, prefix: false };
      } else {
        return expr;
      }
    }
  }

  private parseArgs(): ArgExpr[] {
    const args: ArgExpr[] = [];
    if (this.eatOp(')')) {
      return args;
    }
    for (;;) {
      let spread = false;
      if (this.eatOp('...')) {
        spread = true;
      }
      args.push({ expr: this.parseAssignment(), spread });
      if (this.eatOp(',')) {
        if (this.eatOp(')')) {
          return args; // trailing comma
        }
        continue;
      }
      if (!this.eatOp(')')) {
        throw new ExpressionError('Expected "," or ")" in argument list');
      }
      return args;
    }
  }

  private parsePrimary(): Expr {
    const tok = this.peek();
    if (!tok) {
      throw new ExpressionError('Unexpected end of expression');
    }

    if (tok.t === 'num') {
      this.pos++;
      return { k: 'num', v: tok.n ?? Number(tok.v) };
    }

    if (tok.t === 'str') {
      this.pos++;
      return { k: 'str', v: tok.v };
    }

    if (this.eatOp('(')) {
      const inner = this.parseAssignment();
      if (!this.eatOp(')')) {
        throw new ExpressionError('Expected ")"');
      }
      return inner;
    }

    if (this.isOp('[')) {
      this.pos++;
      const items: ArgExpr[] = [];
      while (!this.eatOp(']')) {
        let spread = false;
        if (this.eatOp('...')) {
          spread = true;
        }
        const first = this.parseAssignment();
        if (this.eatOp('=>')) {
          // PHP-style associative entry: ['key' => value]
          items.push({ expr: { k: 'pair', key: first, value: this.parseAssignment() } as Expr, spread });
        } else {
          items.push({ expr: first, spread });
        }
        if (!this.eatOp(',')) {
          if (!this.eatOp(']')) {
            throw new ExpressionError('Expected "," or "]" in array literal');
          }
          break;
        }
      }
      return { k: 'array', items };
    }

    if (this.isOp('{')) {
      this.pos++;
      const props: Array<{ key: string; value: Expr }> = [];
      while (!this.eatOp('}')) {
        let key: string;
        const keyTok = this.next();
        if (keyTok.t === 'str' || keyTok.t === 'num') {
          key = keyTok.v;
        } else if (keyTok.t === 'name') {
          key = keyTok.v.replace(/^\$/, '');
        } else {
          throw new ExpressionError('Invalid object key');
        }
        if (!this.eatOp(':')) {
          throw new ExpressionError('Expected ":" after object key');
        }
        props.push({ key, value: this.parseAssignment() });
        if (!this.eatOp(',')) {
          if (!this.eatOp('}')) {
            throw new ExpressionError('Expected "," or "}" in object literal');
          }
          break;
        }
      }
      return { k: 'object', props };
    }

    if (tok.t === 'name') {
      this.pos++;
      switch (tok.v) {
        case 'true':
          return { k: 'bool', v: true };
        case 'false':
          return { k: 'bool', v: false };
        case 'null':
          return { k: 'null' };
        case 'undefined':
          return { k: 'undef' };
      }
      return { k: 'ident', name: normalizeName(tok.v) };
    }

    throw new ExpressionError(`Unexpected token [${tok.v}]`);
  }
}

/** Strip the Blade-style leading `$` (and surrounding space) from a name. */
export function normalizeName(name: string): string {
  return name.trim().replace(/^\$/, '').trim();
}

const exprCache = new Map<string, Expr>();

/** Parse (and memoize) an expression string into an expression AST. */
export function parseExpression(src: string): Expr {
  const key = src.trim();
  const hit = exprCache.get(key);
  if (hit) {
    return hit;
  }
  const parsed = new ExprParser(tokenize(key)).parse();
  if (exprCache.size > 2000) {
    exprCache.clear();
  }
  exprCache.set(key, parsed);
  return parsed;
}

// ---------------------------------------------------------------------------
// Helper whitelist
// ---------------------------------------------------------------------------

function helperCount(value: unknown): number {
  if (value == null) {
    return 0;
  }
  if (Array.isArray(value) || typeof value === 'string') {
    return value.length;
  }
  if (value instanceof Map || value instanceof Set) {
    return value.size;
  }
  if (typeof value === 'object') {
    return Object.keys(value).length;
  }
  return 1;
}

/** PHP-ish emptiness: null, false, 0, '', '0' and empty collections. */
export function phpEmpty(value: unknown): boolean {
  if (value === null || value === undefined || value === false || value === 0 || value === '' || value === '0') {
    return true;
  }
  if (Array.isArray(value) && value.length === 0) {
    return true;
  }
  if (value instanceof Map && value.size === 0) {
    return true;
  }
  if (value instanceof Set && value.size === 0) {
    return true;
  }
  if (typeof value === 'object') {
    return Object.keys(value as object).length === 0;
  }
  return false;
}

function helperNumberFormat(
  value: unknown,
  decimals: number = 0,
  decSep: string = '.',
  thousands: string = ','
): string {
  const num = Number(value) || 0;
  const fixed = Math.abs(num).toFixed(decimals);
  const [int, frac] = fixed.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, thousands);
  return (num < 0 ? '-' : '') + grouped + (frac ? decSep + frac : '');
}

/**
 * The sandboxed global functions visible to template expressions. Keep this
 * list free of anything that can reach the host (no globalThis, require,
 * process, Function, ...).
 */
export const HELPERS: Record<string, (...args: any[]) => unknown> = {
  count: helperCount,
  strlen: (v: unknown) => String(v ?? '').length,
  empty: (v: unknown) => phpEmpty(v),
  isset: (...vals: unknown[]) => vals.every((v) => v !== undefined && v !== null),
  strtoupper: (v: unknown) => String(v ?? '').toUpperCase(),
  strtolower: (v: unknown) => String(v ?? '').toLowerCase(),
  ucfirst: (v: unknown) => {
    const s = String(v ?? '');
    return s.charAt(0).toUpperCase() + s.slice(1);
  },
  lcfirst: (v: unknown) => {
    const s = String(v ?? '');
    return s.charAt(0).toLowerCase() + s.slice(1);
  },
  trim: (v: unknown) => String(v ?? '').trim(),
  str_repeat: (v: unknown, times: unknown) => String(v ?? '').repeat(Math.max(0, Number(times) || 0)),
  str_replace: (search: unknown, replace: unknown, subject: unknown) =>
    String(subject ?? '')
      .split(String(search))
      .join(String(replace)),
  str_contains: (subject: unknown, search: unknown) => String(subject ?? '').includes(String(search)),
  str_starts_with: (subject: unknown, search: unknown) => String(subject ?? '').startsWith(String(search)),
  str_ends_with: (subject: unknown, search: unknown) => String(subject ?? '').endsWith(String(search)),
  substr: (v: unknown, start: unknown, length?: unknown) =>
    length === undefined
      ? String(v ?? '').substr(Number(start))
      : String(v ?? '').substr(Number(start), Number(length)),
  number_format: (v: unknown, decimals?: unknown, decSep?: unknown, thousands?: unknown) =>
    helperNumberFormat(
      v,
      decimals === undefined ? 0 : Number(decimals),
      decSep === undefined ? '.' : String(decSep),
      thousands === undefined ? ',' : String(thousands)
    ),
  implode: (glueOrArray: unknown, maybeArray?: unknown) => {
    const glue = maybeArray === undefined ? ',' : String(glueOrArray);
    const arr = (maybeArray === undefined ? glueOrArray : maybeArray) as unknown;
    return toIterable(arr)
      .map((v) => stringifyValue(v))
      .join(glue);
  },
  explode: (delimiter: unknown, v: unknown) => String(v ?? '').split(String(delimiter)),
  json_encode: (v: unknown) => JSON.stringify(v ?? null),
  json_decode: (v: unknown) => {
    try {
      return JSON.parse(String(v));
    } catch {
      return null;
    }
  },
  min: (...vals: unknown[]) =>
    Math.min(...(vals.length === 1 && Array.isArray(vals[0]) ? (vals[0] as unknown[]).map(Number) : vals.map(Number))),
  max: (...vals: unknown[]) =>
    Math.max(...(vals.length === 1 && Array.isArray(vals[0]) ? (vals[0] as unknown[]).map(Number) : vals.map(Number))),
  abs: (v: unknown) => Math.abs(Number(v) || 0),
  round: (v: unknown, precision?: unknown) => {
    const p = Math.pow(10, Number(precision) || 0);
    return Math.round(Number(v) * p) / p;
  },
  floor: (v: unknown) => Math.floor(Number(v)),
  ceil: (v: unknown) => Math.ceil(Number(v)),
  sqrt: (v: unknown) => Math.sqrt(Number(v)),
  is_array: (v: unknown) => Array.isArray(v),
  is_object: (v: unknown) => typeof v === 'object' && v !== null,
  is_string: (v: unknown) => typeof v === 'string',
  is_number: (v: unknown) => typeof v === 'number' && !Number.isNaN(v),
  is_numeric: (v: unknown) => v !== null && v !== '' && !Number.isNaN(Number(v)),
  is_null: (v: unknown) => v === null,
  array_keys: (v: unknown) => (Array.isArray(v) ? v.map((_, i) => i) : Object.keys(Object(v))),
  array_values: (v: unknown) => (Array.isArray(v) ? [...v] : Object.values(Object(v))),
  array_merge: (...vals: unknown[]) => {
    if (vals.every((v) => Array.isArray(v))) {
      return ([] as unknown[]).concat(...(vals as unknown[][]));
    }
    return Object.assign({}, ...vals.map((v) => Object(v)));
  },
  array_sum: (v: unknown) => toIterable(v).reduce((acc: number, item) => acc + Number(item || 0), 0),
  array_slice: (v: unknown, start: unknown, length?: unknown) =>
    toIterable(v).slice(Number(start), length === undefined ? undefined : Number(start) + Number(length)),
  array_reverse: (v: unknown) => [...toIterable(v)].reverse(),
  array_filter: (v: unknown) => toIterable(v).filter(Boolean),
  in_array: (needle: unknown, haystack: unknown) => toIterable(haystack).some((item) => looseEqual(item, needle)),
  range: (start: unknown, end: unknown) => {
    const out: number[] = [];
    const s = Number(start);
    const e = Number(end);
    if (s <= e) {
      for (let i = s; i <= e; i++) out.push(i);
    } else {
      for (let i = s; i >= e; i--) out.push(i);
    }
    return out;
  },
};

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

/** Convert anything iterable-ish (array, object, Map, Set, string) to entries. */
export function toEntries(value: unknown): Array<[unknown, unknown]> {
  if (value == null) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.map((v, i) => [i, v]);
  }
  if (value instanceof Map) {
    return [...value.entries()];
  }
  if (value instanceof Set) {
    return [...value.values()].map((v, i) => [i, v] as [unknown, unknown]);
  }
  if (typeof value === 'string') {
    return [...value].map((ch, i) => [i, ch]);
  }
  if (typeof value === 'object' && Symbol.iterator in value) {
    try {
      return [...(value as Iterable<unknown>)].map((v, i) => [i, v] as [unknown, unknown]);
    } catch {
      return Object.entries(value as object);
    }
  }
  if (typeof value === 'object') {
    return Object.entries(value as object);
  }
  return [];
}

/** The array view of anything iterable (used by `count` and friends). */
export function toIterable(value: unknown): unknown[] {
  return toEntries(value).map(([, v]) => v);
}

/** Blade/PHP-flavoured loose equality used by `==`, switch and in_array. */
export function looseEqual(a: unknown, b: unknown): boolean {
  if (a == b) {
    return true; // eslint-disable-line eqeqeq
  }
  if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

/** Render any value to the string `{{ }}` / `@yield` would output. */
export function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'boolean') {
    return value ? '1' : '';
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'object') {
    if (value instanceof Map) {
      return JSON.stringify(Object.fromEntries(value.entries()));
    }
    if (value instanceof Set) {
      return JSON.stringify([...value]);
    }
    if (typeof (value as { toString?: unknown }).toString === 'function') {
      const asString = String(value);
      if (asString !== '[object Object]') {
        return asString;
      }
    }
    return JSON.stringify(value);
  }
  return String(value);
}

interface LValue {
  read(): unknown;
  write(value: unknown): void;
}

/** Interpret a parsed expression against a view scope. */
export function evalExpr(expr: Expr, scope: Scope): unknown {
  switch (expr.k) {
    case 'num':
      return expr.v;
    case 'str':
      return expr.v;
    case 'bool':
      return expr.v;
    case 'null':
      return null;
    case 'undef':
      return undefined;

    case 'ident': {
      if (expr.name in scope) {
        return (scope as Record<string, unknown>)[expr.name];
      }
      const helper = HELPERS[expr.name];
      if (helper && Object.prototype.hasOwnProperty.call(HELPERS, expr.name)) {
        return helper;
      }
      throw new UndefinedVariableError(expr.name);
    }

    case 'member': {
      const obj = evalExpr(expr.obj, scope);
      if (obj === null || obj === undefined) {
        if (expr.optional) {
          return undefined;
        }
        throw new ExpressionError(`Cannot read property [${expr.prop}] of ${String(obj)}`);
      }
      const record = obj as Record<string, unknown>;
      if (expr.prop in Object(record)) {
        return record[expr.prop];
      }
      // Map-backed data and snake/camel miss: fall through to undefined so
      // `?.` and echoes degrade gracefully.
      if (obj instanceof Map) {
        return obj.get(expr.prop);
      }
      return undefined;
    }

    case 'index': {
      const obj = evalExpr(expr.obj, scope);
      const index = evalExpr(expr.index, scope);
      if (obj === null || obj === undefined) {
        if (expr.optional) {
          return undefined;
        }
        throw new ExpressionError(`Cannot index into ${String(obj)}`);
      }
      if (obj instanceof Map) {
        return obj.get(index);
      }
      if (Array.isArray(obj) || typeof obj === 'string') {
        const n = typeof index === 'number' ? index : Number(index);
        if (Number.isInteger(n)) {
          return (obj as unknown[])[n < 0 ? obj.length + n : n];
        }
      }
      return (obj as Record<string, unknown>)[String(index)];
    }

    case 'call': {
      // `isset()` / `empty()` must observe undefined variables and null-safe
      // chains instead of throwing, so their arguments evaluate lazily.
      if (expr.fn.k === 'ident' && (expr.fn.name === 'isset' || expr.fn.name === 'empty') && !(expr.fn.name in scope)) {
        const values = expr.args.map((arg) => tryEvalExpr(arg.expr, scope));
        return expr.fn.name === 'isset'
          ? values.every((v) => v !== undefined && v !== null)
          : values.every((v) => phpEmpty(v));
      }
      const args = expandArgs(expr.args, scope);
      if (expr.fn.k === 'ident' && !(expr.fn.name in scope) && HELPERS[expr.fn.name]) {
        return HELPERS[expr.fn.name](...args);
      }
      const receiver =
        expr.fn.k === 'member' || expr.fn.k === 'index'
          ? evalExpr((expr.fn as Expr & { obj?: Expr }).obj!, scope)
          : undefined;
      const fn = evalExpr(expr.fn, scope);
      if (typeof fn !== 'function') {
        if (expr.optional && (fn === undefined || fn === null)) {
          return undefined;
        }
        throw new ExpressionError('Attempted to call a non-function value');
      }
      return (fn as (...a: unknown[]) => unknown).apply(receiver, args);
    }

    case 'array': {
      const hasPairs = expr.items.some((item) => item.expr.k === 'pair');
      if (!hasPairs) {
        const out: unknown[] = [];
        for (const item of expr.items) {
          const value = evalExpr(item.expr, scope);
          if (item.spread) {
            out.push(...toIterable(value));
          } else {
            out.push(value);
          }
        }
        return out;
      }

      // Mixed/associative literal: an ordered Map, like a PHP array.
      const map = new Map<unknown, unknown>();
      let position = 0;
      for (const item of expr.items) {
        if (item.expr.k === 'pair') {
          map.set(evalExpr(item.expr.key, scope), evalExpr(item.expr.value, scope));
          continue;
        }
        const value = evalExpr(item.expr, scope);
        if (item.spread) {
          for (const entry of toEntries(value)) {
            map.set(entry[0], entry[1]);
          }
        } else {
          map.set(position++, value);
        }
      }
      return map;
    }

    case 'object': {
      const out: Record<string, unknown> = {};
      for (const prop of expr.props) {
        out[prop.key] = evalExpr(prop.value, scope);
      }
      return out;
    }

    case 'unary': {
      const value = evalExpr(expr.operand, scope);
      if (expr.op === '!') {
        return !value;
      }
      if (expr.op === '-') {
        return -Number(value);
      }
      return Number(value);
    }

    case 'update': {
      const lvalue = lvalueFor(expr.operand, scope);
      const before = Number(lvalue.read()) || 0;
      const after = expr.op === '++' ? before + 1 : before - 1;
      lvalue.write(after);
      return expr.prefix ? after : before;
    }

    case 'binary':
      return binaryOp(expr.op, evalExpr(expr.left, scope), evalExpr(expr.right, scope));

    case 'logical': {
      if (expr.op === '??') {
        // PHP `??` semantics: undefined variables / null member chains on the
        // left fall through instead of erroring.
        let left: unknown;
        try {
          left = evalExpr(expr.left, scope);
        } catch (err) {
          if (err instanceof UndefinedVariableError || err instanceof ExpressionError) {
            left = null;
          } else {
            throw err;
          }
        }
        return left === undefined || left === null ? evalExpr(expr.right, scope) : left;
      }
      const left = evalExpr(expr.left, scope);
      if (expr.op === '&&') {
        return left ? evalExpr(expr.right, scope) : left;
      }
      return left ? left : evalExpr(expr.right, scope);
    }

    case 'ternary':
      return evalExpr(expr.test, scope) ? evalExpr(expr.cons, scope) : evalExpr(expr.alt, scope);

    case 'assign': {
      const lvalue = lvalueFor(expr.target, scope);
      let value = evalExpr(expr.value, scope);
      if (expr.op !== '=') {
        const current = lvalue.read();
        const op = expr.op.slice(0, -1);
        if (op === '&&') {
          value = current && value;
        } else if (op === '||') {
          value = current || value;
        } else if (op === '??') {
          value = current === null || current === undefined ? value : current;
        } else {
          value = binaryOp(op, current, value);
        }
      }
      lvalue.write(value);
      return value;
    }
  }
}

/** Evaluate an expression, degrading undefined variables/null access to undefined. */
function tryEvalExpr(expr: Expr, scope: Scope): unknown {
  try {
    return evalExpr(expr, scope);
  } catch {
    return undefined;
  }
}

function expandArgs(args: ArgExpr[], scope: Scope): unknown[] {
  const out: unknown[] = [];
  for (const arg of args) {
    const value = evalExpr(arg.expr, scope);
    if (arg.spread) {
      out.push(...toIterable(value));
    } else {
      out.push(value);
    }
  }
  return out;
}

function binaryOp(op: string, left: unknown, right: unknown): unknown {
  switch (op) {
    case '+':
      if (typeof left === 'string' || typeof right === 'string') {
        return stringifyValue(left) + stringifyValue(right);
      }
      return Number(left) + Number(right);
    case '-':
      return Number(left) - Number(right);
    case '*':
      return Number(left) * Number(right);
    case '/':
      return Number(left) / Number(right);
    case '%':
      return Number(left) % Number(right);
    case '**':
      return Math.pow(Number(left), Number(right));
    case '<':
      return isComparable(left) && isComparable(right)
        ? (left as number) < (right as number)
        : String(left) < String(right);
    case '>':
      return isComparable(left) && isComparable(right)
        ? (left as number) > (right as number)
        : String(left) > String(right);
    case '<=':
      return isComparable(left) && isComparable(right)
        ? (left as number) <= (right as number)
        : String(left) <= String(right);
    case '>=':
      return isComparable(left) && isComparable(right)
        ? (left as number) >= (right as number)
        : String(left) >= String(right);
    case '==':
      return looseEqual(left, right);
    case '!=':
      return !looseEqual(left, right);
    case '===':
      return left === right;
    case '!==':
      return left !== right;
    case 'in':
      return containsValue(right, left);
  }
  throw new ExpressionError(`Unsupported operator [${op}]`);
}

function isComparable(value: unknown): boolean {
  return typeof value === 'number' || typeof value === 'bigint';
}

/** `x in haystack` for arrays, strings, objects and Maps. */
export function containsValue(haystack: unknown, needle: unknown): boolean {
  if (haystack == null) {
    return false;
  }
  if (typeof haystack === 'string') {
    return haystack.includes(stringifyValue(needle));
  }
  if (Array.isArray(haystack)) {
    return haystack.some((item) => looseEqual(item, needle));
  }
  if (haystack instanceof Map) {
    if (haystack.has(needle)) {
      return true;
    }
    return [...haystack.keys()].some((key) => looseEqual(key, needle));
  }
  if (typeof haystack === 'object') {
    if (Symbol.iterator in haystack) {
      return [...(haystack as Iterable<unknown>)].some((item) => looseEqual(item, needle));
    }
    return Object.prototype.hasOwnProperty.call(haystack, stringifyValue(needle));
  }
  return false;
}

/** Resolve an l-value (identifier / member / index) for assignment/update. */
function lvalueFor(target: Expr, scope: Scope): LValue {
  if (target.k === 'ident') {
    return {
      read: () => (target.name in scope ? (scope as Record<string, unknown>)[target.name] : undefined),
      write: (value) => assignScope(scope, target.name, value),
    };
  }
  if (target.k === 'member') {
    const obj = evalExpr(target.obj, scope);
    if (obj === null || obj === undefined) {
      throw new ExpressionError(`Cannot assign to property [${target.prop}] of ${String(obj)}`);
    }
    return {
      read: () => (obj as Record<string, unknown>)[target.prop],
      write: (value) => {
        (obj as Record<string, unknown>)[target.prop] = value;
      },
    };
  }
  if (target.k === 'index') {
    const obj = evalExpr(target.obj, scope);
    const index = evalExpr(target.index, scope);
    if (obj === null || obj === undefined) {
      throw new ExpressionError('Cannot assign into a null value');
    }
    return {
      read: () => (obj as Record<string, unknown>)[String(index)],
      write: (value) => {
        (obj as Record<string, unknown>)[String(index)] = value;
      },
    };
  }
  throw new ExpressionError('Invalid assignment target');
}

/** Parse and evaluate a single expression from template source. */
export function evaluate(exprSrc: string, scope: Scope): unknown {
  return evalExpr(parseExpression(exprSrc), scope);
}
