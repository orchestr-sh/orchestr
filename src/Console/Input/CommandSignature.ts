/**
 * CommandSignature
 *
 * Parses Laravel-style command signatures into a structured definition:
 *
 *   make:model {name} {--m|migration} {--f|factory} {--s|seed} {--p|pivot} {--all}
 *
 * Supported grammar (mirroring Illuminate\Console\Application::parseSignature):
 *
 * - Arguments:
 *   - `{name}` required argument
 *   - `{name?}` optional argument
 *   - `{name=default}` optional argument with a default value
 *   - `{names*}` array argument (collects all remaining tokens)
 *   - `{names*=a,b}` array argument with defaults
 *   - `{name : Description}` argument description
 * - Options:
 *   - `{--all}` boolean flag (default false)
 *   - `{--m|migration}` option with a shortcut (the shorter part becomes the
 *     shortcut, so `{--f|file}` and `{--file|f}` both work)
 *   - `{--env=}` value option, default null
 *   - `{--env=production}` value option with a default
 *   - `{--tags*}` / `{--tags*=a,b}` array options
 *   - `{--env= : The environment}` option description
 *
 * The legacy Symfony-ish grammar used by the existing built-in commands
 * (`<name>`, `[name]`, `[--opt=]`, `[--flag]`) is accepted as well so every
 * shipped signature keeps working through the kernel's validation, help,
 * and usage rendering.
 */

export interface SignatureArgument {
  /** Argument name, e.g. "name". */
  name: string;
  /** True when the argument must be provided. */
  required: boolean;
  /** True for `{names*}` style arguments that collect all remaining tokens. */
  isArray: boolean;
  /** Default value used when the caller omitted the argument. */
  default: string | string[] | null;
  /** Human description rendered in help output. */
  description: string;
}

export interface SignatureOption {
  /** Canonical long name, e.g. "migration". */
  name: string;
  /** Single-token shortcut such as "m" for `-m`, if declared. */
  shortcut?: string;
  /** True for options that take a value (`{--env=...}`). */
  requiresValue: boolean;
  /** True for `{--tags*}` style options. */
  isArray: boolean;
  /** Default value used when the option was not provided. */
  default: string | string[] | boolean | null;
  /** Human description rendered in help output. */
  description: string;
}

export interface ParsedSignature {
  /** Command name, e.g. "make:model". */
  name: string;
  /** Canonical usage string, e.g. `make:model {name} {--m|migration}`. */
  usage: string;
  /** Declared arguments in positional order. */
  arguments: SignatureArgument[];
  /** Declared options. */
  options: SignatureOption[];
}

/**
 * Thrown when a signature string cannot be parsed.
 */
export class InvalidSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidSignatureError';
  }
}

const ARGUMENT_NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const OPTION_NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;

export class CommandSignature {
  /** Parsed signatures are pure functions of their string, so memoize them. */
  private static cache: Map<string, ParsedSignature> = new Map();

  /**
   * Parse a signature into its structured definition (cached).
   */
  static parse(signature: string): ParsedSignature {
    const cached = CommandSignature.cache.get(signature);

    if (cached !== undefined) {
      return cached;
    }

    const parsed = CommandSignature.build(signature);
    CommandSignature.cache.set(signature, parsed);

    return parsed;
  }

  /**
   * Render the usage line for a signature string.
   */
  static usage(signature: string): string {
    return CommandSignature.parse(signature).usage;
  }

  /**
   * Split a signature into whitespace-separated tokens, keeping bracketed
   * `{...}`/`[...]`/`<...>` groups intact even when they contain spaces
   * (descriptions like `{--env= : The environment}`).
   */
  protected static tokenize(signature: string): string[] {
    const tokens: string[] = [];
    let current = '';
    let open: string | null = null;

    for (const char of signature) {
      if (open === null && /\s/.test(char)) {
        if (current !== '') {
          tokens.push(current);
          current = '';
        }
        continue;
      }

      if (open === null && (char === '{' || char === '[' || char === '<')) {
        open = char;
        current += char;
        continue;
      }

      if (open !== null) {
        current += char;
        const closer = open === '{' ? '}' : open === '[' ? ']' : '>';
        if (char === closer) {
          open = null;
        }
        continue;
      }

      current += char;
    }

    if (open !== null) {
      throw new InvalidSignatureError(`Unbalanced token "${current}" in signature "${signature}".`);
    }

    if (current !== '') {
      tokens.push(current);
    }

    return tokens;
  }

  protected static build(signature: string): ParsedSignature {
    const tokens = CommandSignature.tokenize(signature.trim());

    if (tokens.length === 0) {
      throw new InvalidSignatureError('A command signature must start with the command name.');
    }

    const name = tokens[0];

    if (name.startsWith('{') || name.startsWith('[') || name.startsWith('<')) {
      throw new InvalidSignatureError(
        `Invalid signature "${signature}": the command name must come before any arguments or options.`
      );
    }

    const args: SignatureArgument[] = [];
    const options: SignatureOption[] = [];

    for (const token of tokens.slice(1)) {
      if (token.startsWith('{--') || token.startsWith('[--')) {
        options.push(CommandSignature.parseOption(token, signature));
      } else if (token.startsWith('{') || token.startsWith('<') || token.startsWith('[')) {
        args.push(CommandSignature.parseArgument(token, signature));
      } else {
        throw new InvalidSignatureError(`Unexpected token "${token}" in signature "${signature}".`);
      }
    }

    return { name, usage: tokens.join(' '), arguments: args, options };
  }

  /**
   * Extract the trailing ` : Description` part of a brace token body.
   */
  protected static splitDescription(body: string): { body: string; description: string } {
    const separator = body.indexOf(' : ');

    if (separator === -1) {
      return { body, description: '' };
    }

    let description = body.slice(separator + 3).trim();
    const quoted = /^"(.*)"$/.exec(description) ?? /^'(.*)'$/.exec(description);

    if (quoted) {
      description = quoted[1];
    }

    return { body: body.slice(0, separator).trim(), description };
  }

  protected static parseArgument(token: string, signature: string): SignatureArgument {
    let body: string;
    let optional: boolean;

    if (token.startsWith('<')) {
      // Legacy `<name>`: always required.
      body = token.slice(1, -1);
      optional = false;
    } else if (token.startsWith('[')) {
      // Legacy `[name]`: always optional.
      body = token.slice(1, -1);
      optional = true;
    } else {
      body = token.slice(1, -1);
      optional = false;
    }

    const split = CommandSignature.splitDescription(body);
    body = split.body;

    let rawDefault: string | null = null;
    let isArray = false;

    // Laravel writes array defaults as `{names*=a,b}`: the value is split
    // off first, then the trailing `*`/`?` markers decorate the name.
    const equals = body.indexOf('=');

    if (equals !== -1) {
      rawDefault = body.slice(equals + 1);
      body = body.slice(0, equals);
    }

    if (body.endsWith('*')) {
      isArray = true;
      body = body.slice(0, -1);
    }

    if (body.endsWith('?')) {
      optional = true;
      body = body.slice(0, -1);
    }

    let value: string | string[] | null = null;

    if (rawDefault !== null) {
      value = rawDefault === '' ? (isArray ? [] : null) : isArray ? rawDefault.split(',') : rawDefault;
    }

    const name = body.trim();

    if (!ARGUMENT_NAME.test(name)) {
      throw new InvalidSignatureError(`Invalid argument token "${token}" in signature "${signature}".`);
    }

    return {
      name,
      // Legacy `<name>` is always required; otherwise anything marked
      // optional, defaulted, or array-collecting is not.
      required: token.startsWith('<') || !(optional || rawDefault !== null || isArray),
      isArray,
      default: value,
      description: split.description,
    };
  }

  protected static parseOption(token: string, signature: string): SignatureOption {
    if (!token.startsWith('{--') && !token.startsWith('[--')) {
      throw new InvalidSignatureError(`Invalid option token "${token}" in signature "${signature}".`);
    }

    let body = token.slice(3, -1);

    const split = CommandSignature.splitDescription(body);
    body = split.body;

    let core = body.replace(/^-+/, '');
    let requiresValue = false;
    let rawDefault: string | null = null;

    const equals = core.indexOf('=');

    if (equals !== -1) {
      requiresValue = true;
      rawDefault = core.slice(equals + 1);
      core = core.slice(0, equals);
    }

    let isArray = false;

    if (core.endsWith('*')) {
      isArray = true;
      requiresValue = true;
      core = core.slice(0, -1);
    }

    // Laravel marks value-taking options with `?` in some signatures
    // (`{--f|file?}` hides the option from help); treat it as optional value.
    if (core.endsWith('?')) {
      core = core.slice(0, -1);
    }

    let name = core;
    let shortcut: string | undefined;

    if (core.includes('|')) {
      const parts = core.split('|');

      if (parts.length !== 2) {
        throw new InvalidSignatureError(`Invalid shortcut token "${token}" in signature "${signature}".`);
      }

      const [first, second] = parts;

      if (first.length <= second.length) {
        shortcut = first;
        name = second;
      } else {
        name = first;
        shortcut = second;
      }
    }

    if (!OPTION_NAME.test(name) || (shortcut !== undefined && !OPTION_NAME.test(shortcut))) {
      throw new InvalidSignatureError(`Invalid option token "${token}" in signature "${signature}".`);
    }

    let value: string | string[] | boolean | null;

    if (!requiresValue) {
      value = false;
    } else if (isArray) {
      value = rawDefault === null || rawDefault === '' ? [] : rawDefault.split(',');
    } else {
      value = rawDefault === null || rawDefault === '' ? null : rawDefault;
    }

    return {
      name,
      ...(shortcut !== undefined ? { shortcut } : {}),
      requiresValue,
      isArray,
      default: value,
      description: split.description,
    };
  }
}
