import 'reflect-metadata';

/**
 * A single reflected callable/constructor parameter: the type hint from
 * `design:paramtypes` (when TypeScript emitted it) merged with the name,
 * default-value, and variadic markers parsed from the compiled signature.
 */
export interface ParameterDescriptor {
  name?: string;
  type?: any;
  hasDefault: boolean;
  variadic: boolean;
  /** Whether `design:paramtypes` described this slot at all */
  reflected: boolean;
}

/**
 * Constructor/function types the container cannot build as services.
 * Mirrors the wrapper classes `design:paramtypes` emits for primitives,
 * the same list the routing layer refuses.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
const NON_SERVICES: Function[] = [Object, String, Number, Boolean, Symbol, BigInt, Function];

/**
 * Determine if a reflected parameter type is something the container can
 * construct or resolve as a service.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export function isResolvableType(type: any): type is Function {
  return typeof type === 'function' && !NON_SERVICES.includes(type);
}

/**
 * Determine if a concrete is a factory closure rather than a class.
 * Arrow functions carry no prototype; classes and method functions do.
 */
export function isClosure(concrete: any): boolean {
  return typeof concrete === 'function' && concrete.prototype === undefined;
}

/**
 * Parameter reflection for the container's build pipeline
 *
 * `design:paramtypes` is only emitted when decorators are compiled, and it
 * never carries parameter *names* - so names, default markers, and variadic
 * flags are parsed out of `Function.prototype.toString()`, exactly the
 * technique `RouteResolver` uses for controller actions. Keeping it here as
 * one collaborator means constructors and `call()` targets share a single
 * implementation.
 */
export class ParameterReflector {
  /** Reflection cache keyed by the function or prototype being invoked */
  private static cache: WeakMap<Function, Map<string, ParameterDescriptor[]>> = new WeakMap();

  /**
   * Reflect the constructor signature of a class.
   */
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  static parametersOf(concrete: Function): ParameterDescriptor[] {
    return ParameterReflector.reflect(concrete, 'constructor', () => ParameterReflector.readMetadata(concrete));
  }

  /**
   * Reflect a closure's signature. Metadata is read directly off the
   * function; bound native functions report no parameters, exactly like
   * the historical behaviour of `Container.call()`.
   */
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  static closureParameters(fn: Function): ParameterDescriptor[] {
    return ParameterReflector.reflect(fn, 'closure', () => ParameterReflector.readMetadata(fn));
  }

  /**
   * Reflect a prototype method's signature: `design:paramtypes` is keyed
   * by the owning prototype and the method name.
   */
  static methodParameters(prototype: any, methodName: string): ParameterDescriptor[] {
    const method = prototype ? prototype[methodName] : undefined;

    if (typeof method !== 'function') {
      return [];
    }

    return ParameterReflector.reflect(method, methodName, () => {
      const types = ParameterReflector.readMetadata(prototype, methodName);

      // Own-function methods (plain objects, factory results) carry no
      // keyed metadata; fall back to metadata emitted on the function.
      return types.length > 0 ? types : ParameterReflector.readMetadata(method);
    });
  }

  private static readMetadata(owner: any, key?: string): any[] {
    return (
      (key === undefined
        ? Reflect.getMetadata('design:paramtypes', owner)
        : Reflect.getMetadata('design:paramtypes', owner, key)) ?? []
    );
  }

  private static reflect(
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    fn: Function,
    cacheKey: string,
    readTypes: () => any[]
  ): ParameterDescriptor[] {
    let byKey = ParameterReflector.cache.get(fn);

    if (!byKey) {
      byKey = new Map();
      ParameterReflector.cache.set(fn, byKey);
    }

    const cached = byKey.get(cacheKey);

    if (cached) {
      return cached;
    }

    const types = readTypes();
    const parsed = ParameterReflector.parseSignature(fn);
    const count = Math.max(types.length, parsed.length);
    const descriptors: ParameterDescriptor[] = [];

    for (let index = 0; index < count; index++) {
      descriptors.push({
        name: parsed[index]?.name,
        type: types[index],
        hasDefault: parsed[index]?.hasDefault ?? false,
        variadic: parsed[index]?.variadic ?? false,
        reflected: index < types.length,
      });
    }

    byKey.set(cacheKey, descriptors);

    return descriptors;
  }

  // -------------------------------------------------------------------------
  // Signature parsing
  // -------------------------------------------------------------------------

  /**
   * Parse the declared parameter list of a function out of its source.
   *
   * Handles classes (whose source opens with the `class` keyword and keeps
   * its parameter list on `constructor(...)`), method shorthand, arrows,
   * defaults, and rest parameters. Destructured and rest patterns report
   * no usable name.
   */
  private static parseSignature(fn: Function): Array<{ name?: string; hasDefault: boolean; variadic: boolean }> {
    const source = fn.toString();
    const list = ParameterReflector.parameterList(source);

    if (list === null) {
      return [];
    }

    const trimmed = list.trim();

    if (trimmed === '') {
      return [];
    }

    return ParameterReflector.splitTopLevel(trimmed).map((raw) => ParameterReflector.describeParameter(raw));
  }

  /**
   * Locate the `(...)` parameter list of a declaration, returning the raw
   * text between the parentheses (or null when there is none).
   */
  private static parameterList(source: string): string | null {
    if (/^\s*(?:export\s+)?(?:abstract\s+)?class\s/.test(source)) {
      const open = ParameterReflector.findConstructorParen(source);

      return open === -1 ? null : ParameterReflector.scanToClosing(source, open);
    }

    // Paren-free arrow: `value => ...` - must be probed before the first
    // `(` scan, which would otherwise find a parenthesis in the body.
    const bare = /^\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*=>/.exec(source);

    if (bare) {
      return bare[1];
    }

    const open = source.indexOf('(');

    return open === -1 ? null : ParameterReflector.scanToClosing(source, open);
  }

  /**
   * Find the `(` that opens a class' constructor parameter list, ignoring
   * `super(` calls and method signatures.
   */
  private static findConstructorParen(source: string): number {
    let searchFrom = 0;

    while (true) {
      const found = source.indexOf('constructor', searchFrom);

      if (found === -1) {
        return -1;
      }

      const before = source[found - 1];

      // Must not be a member access (`instance.constructor`) and must be
      // followed by optional whitespace then `(`.
      if (before !== '.' && !/[A-Za-z0-9_$]/.test(before ?? '')) {
        const after = source.slice(found + 'constructor'.length);
        const parenOffset = after.search(/\s*\(/);

        if (parenOffset !== -1) {
          return found + 'constructor'.length + parenOffset;
        }
      }

      searchFrom = found + 'constructor'.length;
    }
  }

  /**
   * Scan from an opening `(` to its matching `)`, respecting nesting and
   * string literals, and return the enclosed text.
   */
  private static scanToClosing(source: string, open: number): string | null {
    let depth = 0;
    let quote: string | null = null;

    for (let i = open; i < source.length; i++) {
      const char = source[i];

      if (quote) {
        if (char === '\\') {
          i++;
        } else if (char === quote) {
          quote = null;
        }

        continue;
      }

      if (char === '"' || char === "'" || char === '`') {
        quote = char;
        continue;
      }

      if (char === '(' || char === '[' || char === '{') {
        depth++;
      } else if (char === ')' || char === ']' || char === '}') {
        depth--;

        if (char === ')' && depth === 0) {
          return source.slice(open + 1, i);
        }
      }
    }

    return null;
  }

  /**
   * Split a parameter list on top-level commas only.
   */
  private static splitTopLevel(list: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let quote: string | null = null;
    let current = '';

    for (let i = 0; i < list.length; i++) {
      const char = list[i];

      if (quote) {
        current += char;

        if (char === '\\') {
          current += list[++i] ?? '';
        } else if (char === quote) {
          quote = null;
        }

        continue;
      }

      if (char === '"' || char === "'" || char === '`') {
        quote = char;
        current += char;
        continue;
      }

      if (char === '(' || char === '[' || char === '{') {
        depth++;
      } else if (char === ')' || char === ']' || char === '}') {
        depth--;
      }

      if (char === ',' && depth === 0) {
        parts.push(current);
        current = '';
        continue;
      }

      current += char;
    }

    if (current.trim() !== '' || parts.length > 0) {
      parts.push(current);
    }

    return parts;
  }

  /**
   * Extract the name, default marker, and variadic flag from one token.
   */
  private static describeParameter(raw: string): { name?: string; hasDefault: boolean; variadic: boolean } {
    let token = raw.trim();
    let hasDefault = false;
    let variadic = false;

    const equals = ParameterReflector.indexOfTopLevelEquals(token);

    if (equals !== -1) {
      hasDefault = true;
      token = token.slice(0, equals).trim();
    }

    if (token.startsWith('...')) {
      variadic = true;
      token = token.slice(3).trim();
    }

    // TS optional markers survive in uncompiled sources
    token = token.replace(/\?\s*$/, '').trim();

    const match = /^([A-Za-z_$][A-Za-z0-9_$]*)$/.exec(token);

    return { name: match ? match[1] : undefined, hasDefault, variadic };
  }

  /**
   * Position of the parameter's own `=` (a default value), ignoring
   * comparison/assignment operators nested in brackets or strings.
   */
  private static indexOfTopLevelEquals(token: string): number {
    let depth = 0;
    let quote: string | null = null;

    for (let i = 0; i < token.length; i++) {
      const char = token[i];

      if (quote) {
        if (char === '\\') {
          i++;
        } else if (char === quote) {
          quote = null;
        }

        continue;
      }

      if (char === '"' || char === "'" || char === '`') {
        quote = char;
        continue;
      }

      if (char === '(' || char === '[' || char === '{') {
        depth++;
      } else if (char === ')' || char === ']' || char === '}') {
        depth--;
      }

      if (char === '=' && depth === 0 && token[i + 1] !== '=' && !/[=!<>+\-*/%&|^]/.test(token[i - 1] ?? '')) {
        return i;
      }
    }

    return -1;
  }
}
