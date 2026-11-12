/**
 * Built-in validation rules - the one map the default registry is seeded
 * from
 *
 * Every string rule the Validator understands lives here as a registry
 * entry, so the Validator loop stays rule-agnostic (no switch on rule
 * names) and custom rules plug in beside the built-ins through the same
 * `RuleRegistry` (OCP). Entries mirror Illuminate\Validation\Concerns.
 */

import type { AuthManager } from '@/Auth/AuthManager';
import type { Authenticatable } from '@/Auth/Contracts/Authenticatable';
import type { Hasher } from '@/Hashing/Contracts/Hasher';
import type { ImageDimensions } from '@/Support/Mimes';
import { isUploadedFile, UploadedFile } from '@/Routing/UploadedFile';
import { getGlobalApp } from '@/Support/helpers';
import { IMAGE_EXTENSIONS } from '@/Support/Mimes';
import type { RuleContext, RuleDefinition } from './Registry';
import { CanRule } from './CanRule';
import { checkPassword, PASSWORD_DEFAULTS } from './PasswordRule';

// ---------------------------------------------------------------------------
// Shared helpers the rule implementations lean on
// ---------------------------------------------------------------------------

const isEmpty = (value: any): boolean => value === undefined || value === null || value === '';
const isPresent = (value: any): boolean => value !== undefined;
const toNumber = (value: any): number => (typeof value === 'number' ? value : parseFloat(String(value)));
const toString = (value: any): string => (typeof value === 'string' ? value : String(value));
const isDate = (value: any): boolean => {
  const d = new Date(value);

  return !isNaN(d.getTime());
};

/**
 * The accepted/declined value sets, mirroring Illuminate's rules
 */
const ACCEPTED_VALUES = ['yes', 'on', '1', 1, true, 'true'];
const DECLINED_VALUES = ['no', 'off', '0', 0, false, 'false'];

/**
 * Resolve the media type and extension file rules compare against for an
 * upload. UploadedFile keeps the detection itself (finfo-style signature
 * sniffing with the client-declared type as fallback); rules that need
 * both values call this once per rule.
 */
async function uploadMeta(value: UploadedFile): Promise<{ mimeType: string; extension: string }> {
  const mimeType = await value.detectedMimeType();

  return { mimeType, extension: await value.guessExtension() };
}

/**
 * Width and height for the dimensions rule: read from an upload's image
 * header (getimagesize in PHP) or from explicit object properties, and
 * null when the value carries nothing measurable
 */
async function imageSize(value: any): Promise<ImageDimensions | null> {
  if (isUploadedFile(value)) {
    return await value.dimensions();
  }

  if (value && typeof value === 'object') {
    const width = Number(value.width ?? value.w);
    const height = Number(value.height ?? value.h);

    if (Number.isFinite(width) && Number.isFinite(height)) {
      return { width, height };
    }
  }

  return null;
}

/**
 * Validate email format
 */
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Validate URL format
 */
function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Compare an "expected value" parameter against a sibling field the same
 * way Laravel does: stringified loose equality against any of the listed
 * expectations (`required_if:field,a,b` passes the comparison when the
 * field equals any value).
 */
function matchesAny(ctx: RuleContext, field: string, expected: string[]): boolean {
  const actual = toString(ctx.other(field));

  return expected.length === 0 ? false : expected.some((candidate) => actual === candidate);
}

/**
 * Resolve the authenticated user for the current_password rule through the
 * container-bound auth manager, exactly like Laravel's
 * `Auth::guard($guard)->user()`
 */
async function resolveAuthUser(guard?: string): Promise<Authenticatable | null> {
  const app = getGlobalApp();

  if (!app) {
    throw new Error('Application not initialized. Call setGlobalApp() first.');
  }

  if (!app.bound('auth')) {
    throw new Error('Authentication is not available. Register the AuthServiceProvider first.');
  }

  return app.make<AuthManager>('auth').guard(guard).user();
}

/**
 * The hasher current_password verifies against: the container's 'hash'
 * service when registered, mirroring Laravel's `hash()` helper
 */
function resolveHasher(): Hasher {
  const app = getGlobalApp();

  if (!app || !app.bound('hash')) {
    throw new Error('Hashing is not available. Register the HashServiceProvider first.');
  }

  return app.make<Hasher>('hash');
}

// ---------------------------------------------------------------------------
// The map
// ---------------------------------------------------------------------------

export const builtInRules: Record<string, RuleDefinition> = {
  // ------------------------------------------------------------------------
  // Control flow: flags and exclude modifiers
  // ------------------------------------------------------------------------

  bail: { passes: () => true },

  nullable: { passes: () => true },

  sometimes: { passes: () => true },

  exclude: { exclude: true, passes: () => true },

  exclude_if: {
    exclude: true,
    fieldParams: true,
    passes: (ctx) => matchesAny(ctx, ctx.list[0], ctx.list.slice(1)),
  },

  exclude_unless: {
    exclude: true,
    fieldParams: true,
    passes: (ctx) => !matchesAny(ctx, ctx.list[0], ctx.list.slice(1)),
  },

  exclude_with: {
    exclude: true,
    fieldParams: true,
    passes: (ctx) => ctx.list.some((f) => ctx.has(f)),
  },

  exclude_without: {
    exclude: true,
    fieldParams: true,
    passes: (ctx) => ctx.list.some((f) => !ctx.has(f)),
  },

  // ------------------------------------------------------------------------
  // Presence
  // ------------------------------------------------------------------------

  required: {
    passes: (ctx) => (isEmpty(ctx.value) ? ctx.fail(`The ${ctx.attribute} field is required.`) : true),
  },

  required_if: {
    fieldParams: true,
    passes: (ctx) =>
      matchesAny(ctx, ctx.list[0], ctx.list.slice(1)) && isEmpty(ctx.value)
        ? ctx.fail(`The ${ctx.attribute} field is required.`)
        : true,
  },

  required_unless: {
    fieldParams: true,
    passes: (ctx) =>
      !matchesAny(ctx, ctx.list[0], ctx.list.slice(1)) && isEmpty(ctx.value)
        ? ctx.fail(`The ${ctx.attribute} field is required.`)
        : true,
  },

  required_with: {
    fieldParams: true,
    passes: (ctx) =>
      ctx.list.some((f) => isPresent(ctx.other(f))) && isEmpty(ctx.value)
        ? ctx.fail(`The ${ctx.attribute} field is required.`)
        : true,
  },

  required_with_all: {
    fieldParams: true,
    passes: (ctx) =>
      ctx.list.length > 0 && ctx.list.every((f) => isPresent(ctx.other(f))) && isEmpty(ctx.value)
        ? ctx.fail(`The ${ctx.attribute} field is required.`)
        : true,
  },

  required_without: {
    fieldParams: true,
    passes: (ctx) =>
      ctx.list.some((f) => !isPresent(ctx.other(f))) && isEmpty(ctx.value)
        ? ctx.fail(`The ${ctx.attribute} field is required.`)
        : true,
  },

  required_without_all: {
    fieldParams: true,
    passes: (ctx) =>
      ctx.list.length > 0 && ctx.list.every((f) => !isPresent(ctx.other(f))) && isEmpty(ctx.value)
        ? ctx.fail(`The ${ctx.attribute} field is required.`)
        : true,
  },

  present: {
    passes: (ctx) => (isPresent(ctx.value) ? true : ctx.fail(`The ${ctx.attribute} field must be present.`)),
  },

  present_if: {
    fieldParams: true,
    passes: (ctx) =>
      matchesAny(ctx, ctx.list[0], ctx.list.slice(1)) && !isPresent(ctx.value)
        ? ctx.fail(`The ${ctx.attribute} field must be present.`)
        : true,
  },

  present_unless: {
    fieldParams: true,
    passes: (ctx) =>
      !matchesAny(ctx, ctx.list[0], ctx.list.slice(1)) && !isPresent(ctx.value)
        ? ctx.fail(`The ${ctx.attribute} field must be present.`)
        : true,
  },

  present_with: {
    fieldParams: true,
    passes: (ctx) =>
      ctx.list.some((f) => isPresent(ctx.other(f))) && !isPresent(ctx.value)
        ? ctx.fail(`The ${ctx.attribute} field must be present.`)
        : true,
  },

  present_with_all: {
    fieldParams: true,
    passes: (ctx) =>
      ctx.list.length > 0 && ctx.list.every((f) => isPresent(ctx.other(f))) && !isPresent(ctx.value)
        ? ctx.fail(`The ${ctx.attribute} field must be present.`)
        : true,
  },

  filled: {
    passes: (ctx) =>
      isPresent(ctx.value) && isEmpty(ctx.value) ? ctx.fail(`The ${ctx.attribute} must have a value.`) : true,
  },

  accepted: {
    passes: (ctx) => (ACCEPTED_VALUES.includes(ctx.value) ? true : ctx.fail(`The ${ctx.attribute} must be accepted.`)),
  },

  accepted_if: {
    fieldParams: true,
    passes: (ctx) =>
      matchesAny(ctx, ctx.list[0], ctx.list.slice(1)) && !ACCEPTED_VALUES.includes(ctx.value)
        ? ctx.fail(`The ${ctx.attribute} must be accepted.`)
        : true,
  },

  declined: {
    passes: (ctx) => (DECLINED_VALUES.includes(ctx.value) ? true : ctx.fail(`The ${ctx.attribute} must be declined.`)),
  },

  declined_if: {
    fieldParams: true,
    passes: (ctx) =>
      matchesAny(ctx, ctx.list[0], ctx.list.slice(1)) && !DECLINED_VALUES.includes(ctx.value)
        ? ctx.fail(`The ${ctx.attribute} must be declined.`)
        : true,
  },

  missing: {
    passes: (ctx) =>
      isPresent(ctx.value) && !isEmpty(ctx.value) ? ctx.fail(`The ${ctx.attribute} must be missing.`) : true,
  },

  missing_if: {
    fieldParams: true,
    passes: (ctx) =>
      matchesAny(ctx, ctx.list[0], ctx.list.slice(1)) && isPresent(ctx.value) && !isEmpty(ctx.value)
        ? ctx.fail(`The ${ctx.attribute} must be missing.`)
        : true,
  },

  missing_unless: {
    fieldParams: true,
    passes: (ctx) =>
      !matchesAny(ctx, ctx.list[0], ctx.list.slice(1)) && isPresent(ctx.value) && !isEmpty(ctx.value)
        ? ctx.fail(`The ${ctx.attribute} must be missing.`)
        : true,
  },

  missing_with: {
    fieldParams: true,
    passes: (ctx) =>
      ctx.list.some((f) => isPresent(ctx.other(f))) && isPresent(ctx.value) && !isEmpty(ctx.value)
        ? ctx.fail(`The ${ctx.attribute} must be missing.`)
        : true,
  },

  missing_with_all: {
    fieldParams: true,
    passes: (ctx) =>
      ctx.list.length > 0 &&
      ctx.list.every((f) => isPresent(ctx.other(f))) &&
      isPresent(ctx.value) &&
      !isEmpty(ctx.value)
        ? ctx.fail(`The ${ctx.attribute} must be missing.`)
        : true,
  },

  prohibited: {
    passes: (ctx) => (isPresent(ctx.value) ? ctx.fail(`The ${ctx.attribute} field is prohibited.`) : true),
  },

  prohibited_if: {
    fieldParams: true,
    passes: (ctx) =>
      matchesAny(ctx, ctx.list[0], ctx.list.slice(1)) && isPresent(ctx.value)
        ? ctx.fail(`The ${ctx.attribute} field is prohibited.`)
        : true,
  },

  prohibited_unless: {
    fieldParams: true,
    passes: (ctx) =>
      !matchesAny(ctx, ctx.list[0], ctx.list.slice(1)) && isPresent(ctx.value)
        ? ctx.fail(`The ${ctx.attribute} field is prohibited.`)
        : true,
  },

  prohibits: {
    fieldParams: true,
    passes: (ctx) =>
      isPresent(ctx.value) && ctx.list.some((f) => isPresent(ctx.other(f)))
        ? ctx.fail(`The ${ctx.attribute} prohibits ${ctx.list.join(', ')} from being present.`)
        : true,
  },

  // ------------------------------------------------------------------------
  // Types
  // ------------------------------------------------------------------------

  string: {
    passes: (ctx) =>
      ctx.value && typeof ctx.value !== 'string' ? ctx.fail(`The ${ctx.attribute} must be a string.`) : true,
  },

  numeric: {
    passes: (ctx) =>
      ctx.value && isNaN(Number(ctx.value)) ? ctx.fail(`The ${ctx.attribute} must be a number.`) : true,
  },

  number: {
    passes: (ctx) =>
      ctx.value && isNaN(Number(ctx.value)) ? ctx.fail(`The ${ctx.attribute} must be a number.`) : true,
  },

  integer: {
    passes: (ctx) =>
      ctx.value && (!Number.isInteger(Number(ctx.value)) || isNaN(Number(ctx.value)))
        ? ctx.fail(`The ${ctx.attribute} must be an integer.`)
        : true,
  },

  boolean: {
    passes: (ctx) => {
      const value = ctx.value;

      if (
        value !== undefined &&
        typeof value !== 'boolean' &&
        value !== 'true' &&
        value !== 'false' &&
        value !== 1 &&
        value !== 0 &&
        value !== '1' &&
        value !== '0'
      ) {
        return ctx.fail(`The ${ctx.attribute} must be true or false.`);
      }

      return true;
    },
  },

  array: {
    passes: (ctx) => {
      // Laravel's is_array covers lists and keyed maps alike
      const isArrayValue = Array.isArray(ctx.value) || (ctx.value && typeof ctx.value === 'object');

      if (ctx.value && !isArrayValue) {
        return ctx.fail(`The ${ctx.attribute} must be an array.`);
      }

      // `array:a,b` additionally pins the allowed keys, like Laravel's
      // validateArray
      if (isArrayValue && ctx.list.length > 0) {
        const keys = Object.keys(ctx.value);

        if (!keys.every((k) => ctx.list.includes(k))) {
          return ctx.fail(`The ${ctx.attribute} must be an array.`);
        }
      }

      return true;
    },
  },

  list: {
    passes: (ctx) => {
      if (ctx.value === undefined) {
        return true;
      }

      const valid =
        Array.isArray(ctx.value) &&
        ctx.value.length === Object.keys(ctx.value).length &&
        ctx.value.every((_, i) => String(i) in (ctx.value as any[]));

      return valid ? true : ctx.fail(`The ${ctx.attribute} must be a list.`);
    },
  },

  required_array_keys: {
    passes: (ctx) => {
      const keys = ctx.list;

      if (ctx.value === undefined || ctx.value === null || typeof ctx.value !== 'object') {
        return ctx.fail(`The ${ctx.attribute} must be an array.`);
      }

      const missing = keys.filter((k) => !Object.prototype.hasOwnProperty.call(ctx.value, k));

      return missing.length > 0 ? ctx.fail(`The ${ctx.attribute} must contain keys: ${keys.join(', ')}.`) : true;
    },
  },

  json: {
    passes: (ctx) => {
      if (ctx.value) {
        try {
          JSON.parse(typeof ctx.value === 'string' ? ctx.value : String(ctx.value));
        } catch {
          return ctx.fail(`The ${ctx.attribute} must be a valid JSON.`);
        }
      }

      return true;
    },
  },

  // ------------------------------------------------------------------------
  // Sizes
  // ------------------------------------------------------------------------

  min: {
    passes: (ctx) => {
      const minValue = ctx.params[0];

      if (isUploadedFile(ctx.value)) {
        return ctx.value.getSize() / 1024 < parseFloat(minValue)
          ? ctx.fail(`The ${ctx.attribute} must be at least ${minValue} kilobytes.`)
          : true;
      }

      if (typeof ctx.value === 'string' && ctx.value.length < parseInt(minValue)) {
        return ctx.fail(`The ${ctx.attribute} must be at least ${minValue} characters.`);
      }

      if (typeof ctx.value === 'number' && ctx.value < parseFloat(minValue)) {
        return ctx.fail(`The ${ctx.attribute} must be at least ${minValue}.`);
      }

      return true;
    },
  },

  max: {
    passes: (ctx) => {
      const maxValue = ctx.params[0];

      if (isUploadedFile(ctx.value)) {
        return ctx.value.getSize() / 1024 > parseFloat(maxValue)
          ? ctx.fail(`The ${ctx.attribute} may not be greater than ${maxValue} kilobytes.`)
          : true;
      }

      if (typeof ctx.value === 'string' && ctx.value.length > parseInt(maxValue)) {
        return ctx.fail(`The ${ctx.attribute} may not be greater than ${maxValue} characters.`);
      }

      if (typeof ctx.value === 'number' && ctx.value > parseFloat(maxValue)) {
        return ctx.fail(`The ${ctx.attribute} may not be greater than ${maxValue}.`);
      }

      return true;
    },
  },

  between: {
    passes: (ctx) => {
      const [minBetween, maxBetween] = ctx.params;
      const numValue = typeof ctx.value === 'string' ? ctx.value.length : Number(ctx.value);

      return numValue < parseFloat(minBetween) || numValue > parseFloat(maxBetween)
        ? ctx.fail(`The ${ctx.attribute} must be between ${minBetween} and ${maxBetween}.`)
        : true;
    },
  },

  size: {
    passes: (ctx) => {
      const sizeValue = ctx.params[0];

      if (isUploadedFile(ctx.value)) {
        return ctx.value.getSize() / 1024 !== parseFloat(sizeValue)
          ? ctx.fail(`The ${ctx.attribute} must be ${sizeValue} kilobytes.`)
          : true;
      }

      if (typeof ctx.value === 'string' && ctx.value.length !== parseInt(sizeValue)) {
        return ctx.fail(`The ${ctx.attribute} must be ${sizeValue} characters.`);
      }

      if (typeof ctx.value === 'number' && ctx.value !== parseFloat(sizeValue)) {
        return ctx.fail(`The ${ctx.attribute} must be ${sizeValue}.`);
      }

      return true;
    },
  },

  // ------------------------------------------------------------------------
  // Values
  // ------------------------------------------------------------------------

  in: {
    passes: (ctx) =>
      ctx.value && !ctx.list.includes(String(ctx.value)) ? ctx.fail(`The selected ${ctx.attribute} is invalid.`) : true,
  },

  not_in: {
    passes: (ctx) =>
      ctx.value && ctx.list.includes(String(ctx.value)) ? ctx.fail(`The selected ${ctx.attribute} is invalid.`) : true,
  },

  distinct: {
    passes: (ctx) => {
      if (Array.isArray(ctx.value)) {
        const set = new Set(ctx.value.map((v: any) => JSON.stringify(v)));

        if (set.size !== ctx.value.length) {
          return ctx.fail(`The ${ctx.attribute} must not have duplicates.`);
        }
      }

      return true;
    },
  },

  in_array: {
    fieldParams: true,
    passes: (ctx) => {
      const arr = ctx.other(ctx.list[0]);

      return !Array.isArray(arr) || !arr.map((v: any) => String(v)).includes(String(ctx.value))
        ? ctx.fail(`The ${ctx.attribute} must be in ${ctx.params[0]}.`)
        : true;
    },
  },

  confirmed: {
    passes: (ctx) => {
      const confirmationValue = ctx.other(`${ctx.field}_confirmation`);

      return ctx.value !== confirmationValue ? ctx.fail(`The ${ctx.attribute} confirmation does not match.`) : true;
    },
  },

  same: {
    fieldParams: true,
    passes: (ctx) =>
      toString(ctx.value) !== toString(ctx.other(ctx.list[0]))
        ? ctx.fail(`The ${ctx.attribute} must match ${ctx.params[0]}.`)
        : true,
  },

  different: {
    fieldParams: true,
    passes: (ctx) =>
      toString(ctx.value) === toString(ctx.other(ctx.list[0]))
        ? ctx.fail(`The ${ctx.attribute} must be different from ${ctx.params[0]}.`)
        : true,
  },

  gt: {
    fieldParams: true,
    passes: (ctx) => {
      const [otherFieldOrValue] = ctx.list;
      const cmp = isNaN(Number(otherFieldOrValue)) ? ctx.other(otherFieldOrValue) : parseFloat(otherFieldOrValue);

      return toNumber(ctx.value) > toNumber(cmp)
        ? true
        : ctx.fail(`The ${ctx.attribute} must be greater than ${otherFieldOrValue}.`);
    },
  },

  gte: {
    fieldParams: true,
    passes: (ctx) => {
      const [otherFieldOrValue] = ctx.list;
      const cmp = isNaN(Number(otherFieldOrValue)) ? ctx.other(otherFieldOrValue) : parseFloat(otherFieldOrValue);

      return toNumber(ctx.value) >= toNumber(cmp)
        ? true
        : ctx.fail(`The ${ctx.attribute} must be greater than or equal to ${otherFieldOrValue}.`);
    },
  },

  lt: {
    fieldParams: true,
    passes: (ctx) => {
      const [otherFieldOrValue] = ctx.list;
      const cmp = isNaN(Number(otherFieldOrValue)) ? ctx.other(otherFieldOrValue) : parseFloat(otherFieldOrValue);

      return toNumber(ctx.value) < toNumber(cmp)
        ? true
        : ctx.fail(`The ${ctx.attribute} must be less than ${otherFieldOrValue}.`);
    },
  },

  lte: {
    fieldParams: true,
    passes: (ctx) => {
      const [otherFieldOrValue] = ctx.list;
      const cmp = isNaN(Number(otherFieldOrValue)) ? ctx.other(otherFieldOrValue) : parseFloat(otherFieldOrValue);

      return toNumber(ctx.value) <= toNumber(cmp)
        ? true
        : ctx.fail(`The ${ctx.attribute} must be less than or equal to ${otherFieldOrValue}.`);
    },
  },

  // ------------------------------------------------------------------------
  // Strings
  // ------------------------------------------------------------------------

  email: {
    passes: (ctx) =>
      ctx.value && !isValidEmail(ctx.value) ? ctx.fail(`The ${ctx.attribute} must be a valid email address.`) : true,
  },

  url: {
    passes: (ctx) =>
      ctx.value && !isValidUrl(ctx.value) ? ctx.fail(`The ${ctx.attribute} must be a valid URL.`) : true,
  },

  active_url: {
    passes: (ctx) =>
      ctx.value && !isValidUrl(ctx.value) ? ctx.fail(`The ${ctx.attribute} is not a valid URL.`) : true,
  },

  alpha: {
    passes: (ctx) =>
      ctx.value && !/^[a-zA-Z]+$/.test(ctx.value) ? ctx.fail(`The ${ctx.attribute} may only contain letters.`) : true,
  },

  alpha_num: {
    passes: (ctx) =>
      ctx.value && !/^[a-zA-Z0-9]+$/.test(ctx.value)
        ? ctx.fail(`The ${ctx.attribute} may only contain letters and numbers.`)
        : true,
  },

  alpha_dash: {
    passes: (ctx) =>
      ctx.value && !/^[a-zA-Z0-9_-]+$/.test(ctx.value)
        ? ctx.fail(`The ${ctx.attribute} may only contain letters, numbers, dashes and underscores.`)
        : true,
  },

  regex: {
    passes: (ctx) => {
      const pattern = new RegExp(ctx.params.join(':'));

      return ctx.value && !pattern.test(ctx.value) ? ctx.fail(`The ${ctx.attribute} format is invalid.`) : true;
    },
  },

  not_regex: {
    passes: (ctx) => {
      const pattern = new RegExp(ctx.params.join(':'));

      return ctx.value && pattern.test(ctx.value) ? ctx.fail(`The ${ctx.attribute} format is invalid.`) : true;
    },
  },

  ascii: {
    passes: (ctx) =>
      ctx.value && /[^\x00-\x7F]/.test(toString(ctx.value))
        ? ctx.fail(`The ${ctx.attribute} must be ASCII characters.`)
        : true,
  },

  lowercase: {
    passes: (ctx) =>
      ctx.value && toString(ctx.value) !== toString(ctx.value).toLowerCase()
        ? ctx.fail(`The ${ctx.attribute} must be lowercase.`)
        : true,
  },

  uppercase: {
    passes: (ctx) =>
      ctx.value && toString(ctx.value) !== toString(ctx.value).toUpperCase()
        ? ctx.fail(`The ${ctx.attribute} must be uppercase.`)
        : true,
  },

  starts_with: {
    passes: (ctx) => {
      if (ctx.value) {
        const s = toString(ctx.value);

        if (!ctx.list.some((p) => s.startsWith(p))) {
          return ctx.fail(`The ${ctx.attribute} must start with one of: ${ctx.list.join(', ')}.`);
        }
      }

      return true;
    },
  },

  ends_with: {
    passes: (ctx) => {
      if (ctx.value) {
        const s = toString(ctx.value);

        if (!ctx.list.some((p) => s.endsWith(p))) {
          return ctx.fail(`The ${ctx.attribute} must end with one of: ${ctx.list.join(', ')}.`);
        }
      }

      return true;
    },
  },

  doesnt_start_with: {
    passes: (ctx) => {
      if (ctx.value) {
        const s = toString(ctx.value);

        if (ctx.list.some((p) => s.startsWith(p))) {
          return ctx.fail(`The ${ctx.attribute} must not start with one of: ${ctx.list.join(', ')}.`);
        }
      }

      return true;
    },
  },

  doesnt_end_with: {
    passes: (ctx) => {
      if (ctx.value) {
        const s = toString(ctx.value);

        if (ctx.list.some((p) => s.endsWith(p))) {
          return ctx.fail(`The ${ctx.attribute} must not end with one of: ${ctx.list.join(', ')}.`);
        }
      }

      return true;
    },
  },

  decimal: {
    passes: (ctx) => {
      const places = ctx.params[0] ? parseInt(ctx.params[0]) : undefined;

      if (ctx.value !== undefined) {
        const s = toString(ctx.value);
        const m = s.match(/^[-+]?\d+(\.(\d+))?$/);

        if (!m) {
          return ctx.fail(`The ${ctx.attribute} must be a decimal.`);
        }

        if (places !== undefined) {
          const dp = m[2]?.length || 0;

          if (dp !== places) {
            return ctx.fail(`The ${ctx.attribute} must have ${places} decimal places.`);
          }
        }
      }

      return true;
    },
  },

  // ------------------------------------------------------------------------
  // Numbers
  // ------------------------------------------------------------------------

  digits: {
    passes: (ctx) => {
      const len = parseInt(ctx.params[0]);

      return !/^\d+$/.test(String(ctx.value)) || String(ctx.value).length !== len
        ? ctx.fail(`The ${ctx.attribute} must be ${len} digits.`)
        : true;
    },
  },

  digits_between: {
    passes: (ctx) => {
      const minD = parseInt(ctx.params[0]);
      const maxD = parseInt(ctx.params[1]);
      const s = String(ctx.value);

      return !/^\d+$/.test(s) || s.length < minD || s.length > maxD
        ? ctx.fail(`The ${ctx.attribute} must be between ${minD} and ${maxD} digits.`)
        : true;
    },
  },

  min_digits: {
    passes: (ctx) => {
      const minD = parseInt(ctx.params[0]);
      const s = String(ctx.value);

      return !/^\d+$/.test(s) || s.length < minD
        ? ctx.fail(`The ${ctx.attribute} must be at least ${minD} digits.`)
        : true;
    },
  },

  max_digits: {
    passes: (ctx) => {
      const maxD = parseInt(ctx.params[0]);
      const s = String(ctx.value);

      return !/^\d+$/.test(s) || s.length > maxD
        ? ctx.fail(`The ${ctx.attribute} must be at most ${maxD} digits.`)
        : true;
    },
  },

  multiple_of: {
    passes: (ctx) => {
      const base = parseFloat(ctx.params[0]);

      return Number.isFinite(base) && toNumber(ctx.value) % base !== 0
        ? ctx.fail(`The ${ctx.attribute} must be a multiple of ${base}.`)
        : true;
    },
  },

  // ------------------------------------------------------------------------
  // Dates
  // ------------------------------------------------------------------------

  date: {
    passes: (ctx) => (ctx.value && !isDate(ctx.value) ? ctx.fail(`The ${ctx.attribute} is not a valid date.`) : true),
  },

  date_equals: {
    passes: (ctx) => {
      if (ctx.value) {
        const d1 = new Date(ctx.value).getTime();
        const d2 = new Date(ctx.params[0]).getTime();

        if (isNaN(d1) || isNaN(d2) || d1 !== d2) {
          return ctx.fail(`The ${ctx.attribute} must equal ${ctx.params[0]}.`);
        }
      }

      return true;
    },
  },

  after: {
    fieldParams: true,
    passes: (ctx) => {
      const cmp = ctx.params[0];
      const v = new Date(ctx.value).getTime();
      const ov = ctx.other(cmp);
      const c = isDate(ov) ? new Date(ov).getTime() : new Date(cmp).getTime();

      return isNaN(v) || isNaN(c) || v <= c ? ctx.fail(`The ${ctx.attribute} must be after ${cmp}.`) : true;
    },
  },

  after_or_equal: {
    fieldParams: true,
    passes: (ctx) => {
      const cmp = ctx.params[0];
      const v = new Date(ctx.value).getTime();
      const ov = ctx.other(cmp);
      const c = isDate(ov) ? new Date(ov).getTime() : new Date(cmp).getTime();

      return isNaN(v) || isNaN(c) || v < c ? ctx.fail(`The ${ctx.attribute} must be after or equal to ${cmp}.`) : true;
    },
  },

  before: {
    fieldParams: true,
    passes: (ctx) => {
      const cmp = ctx.params[0];
      const v = new Date(ctx.value).getTime();
      const ov = ctx.other(cmp);
      const c = isDate(ov) ? new Date(ov).getTime() : new Date(cmp).getTime();

      return isNaN(v) || isNaN(c) || v >= c ? ctx.fail(`The ${ctx.attribute} must be before ${cmp}.`) : true;
    },
  },

  before_or_equal: {
    fieldParams: true,
    passes: (ctx) => {
      const cmp = ctx.params[0];
      const v = new Date(ctx.value).getTime();
      const ov = ctx.other(cmp);
      const c = isDate(ov) ? new Date(ov).getTime() : new Date(cmp).getTime();

      return isNaN(v) || isNaN(c) || v > c ? ctx.fail(`The ${ctx.attribute} must be before or equal to ${cmp}.`) : true;
    },
  },

  // ------------------------------------------------------------------------
  // Network
  // ------------------------------------------------------------------------

  uuid: {
    passes: (ctx) =>
      ctx.value &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{4}-[0-9a-f]{12}$/i.test(toString(ctx.value))
        ? ctx.fail(`The ${ctx.attribute} must be a valid UUID.`)
        : true,
  },

  timezone: {
    passes: (ctx) => {
      if (ctx.value) {
        const v = toString(ctx.value);
        const zones = (Intl as any).supportedValuesOf ? (Intl as any).supportedValuesOf('timeZone') : [];

        if (!zones.includes(v)) {
          return ctx.fail(`The ${ctx.attribute} must be a valid timezone.`);
        }
      }

      return true;
    },
  },

  ip: {
    passes: (ctx) =>
      ctx.value && !/^((25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(25[0-5]|2[0-4]\d|[01]?\d\d?)$/.test(toString(ctx.value))
        ? ctx.fail(`The ${ctx.attribute} must be a valid IP address.`)
        : true,
  },

  ipv4: {
    passes: (ctx) =>
      ctx.value && !/^((25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(25[0-5]|2[0-4]\d|[01]?\d\d?)$/.test(toString(ctx.value))
        ? ctx.fail(`The ${ctx.attribute} must be a valid IPv4 address.`)
        : true,
  },

  ipv6: {
    passes: (ctx) =>
      ctx.value && !/^([0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}$/i.test(toString(ctx.value))
        ? ctx.fail(`The ${ctx.attribute} must be a valid IPv6 address.`)
        : true,
  },

  mac_address: {
    passes: (ctx) =>
      ctx.value && !/^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/.test(toString(ctx.value))
        ? ctx.fail(`The ${ctx.attribute} must be a valid MAC address.`)
        : true,
  },

  // ------------------------------------------------------------------------
  // Files
  // ------------------------------------------------------------------------

  file: {
    passes: (ctx) => {
      if (isUploadedFile(ctx.value)) {
        return ctx.value.isValid() ? true : ctx.fail(`The ${ctx.attribute} must be a file.`);
      }

      if (ctx.value && typeof ctx.value !== 'object') {
        return ctx.fail(`The ${ctx.attribute} must be a file.`);
      }

      return true;
    },
  },

  image: {
    passes: async (ctx) => {
      if (isUploadedFile(ctx.value)) {
        if (!ctx.value.isValid()) {
          return ctx.fail(`The ${ctx.attribute} must be an image.`);
        }

        const meta = await uploadMeta(ctx.value);

        return !IMAGE_EXTENSIONS.includes(meta.extension) && !meta.mimeType.startsWith('image/')
          ? ctx.fail(`The ${ctx.attribute} must be an image.`)
          : true;
      }

      if (ctx.value && typeof ctx.value === 'object') {
        const type = (ctx.value.mimetype || ctx.value.type || '').toString();

        if (!type.startsWith('image/')) {
          return ctx.fail(`The ${ctx.attribute} must be an image.`);
        }
      }

      return true;
    },
  },

  mimetypes: {
    passes: async (ctx) => {
      const allowed = ctx.list;

      if (isUploadedFile(ctx.value)) {
        const meta = ctx.value.isValid() ? await uploadMeta(ctx.value) : null;

        return meta === null || !allowed.includes(meta.mimeType)
          ? ctx.fail(`The ${ctx.attribute} has an invalid mimetype.`)
          : true;
      }

      if (ctx.value && typeof ctx.value === 'object') {
        const type = (ctx.value.mimetype || ctx.value.type || '').toString();

        if (!allowed.includes(type)) {
          return ctx.fail(`The ${ctx.attribute} has an invalid mimetype.`);
        }
      }

      return true;
    },
  },

  mimes: {
    passes: async (ctx) => {
      const allowed = ctx.list;

      if (isUploadedFile(ctx.value)) {
        if (!ctx.value.isValid()) {
          return ctx.fail(`The ${ctx.attribute} has an invalid file type.`);
        }

        const meta = await uploadMeta(ctx.value);

        return !(allowed.includes(meta.extension) || allowed.some((m) => meta.mimeType.endsWith(`/${m}`)))
          ? ctx.fail(`The ${ctx.attribute} has an invalid file type.`)
          : true;
      }

      if (ctx.value && typeof ctx.value === 'object') {
        const type = (ctx.value.mimetype || ctx.value.type || '').toString();
        const ext = (ctx.value.extension || '').toString();

        if (!(allowed.includes(ext) || allowed.some((m) => type.endsWith(`/${m}`)))) {
          return ctx.fail(`The ${ctx.attribute} has an invalid file type.`);
        }
      }

      return true;
    },
  },

  dimensions: {
    passes: async (ctx) => {
      // Laravel: dimensions:min_width=100,min_height=100,max_width=1000,...
      const limits: Record<string, number> = {};

      for (const param of ctx.list) {
        const separator = param.indexOf('=');

        if (separator !== -1) {
          limits[param.slice(0, separator)] = Number(param.slice(separator + 1));
        }
      }

      const size = await imageSize(ctx.value);

      if (size !== null) {
        const { width, height } = size;
        const pixels = width * height;
        const invalid =
          (limits['width'] !== undefined && width !== limits['width']) ||
          (limits['height'] !== undefined && height !== limits['height']) ||
          (limits['min_width'] !== undefined && width < limits['min_width']) ||
          (limits['max_width'] !== undefined && width > limits['max_width']) ||
          (limits['min_height'] !== undefined && height < limits['min_height']) ||
          (limits['max_height'] !== undefined && height > limits['max_height']) ||
          (limits['pixels'] !== undefined && pixels !== limits['pixels']) ||
          (limits['min_pixels'] !== undefined && pixels < limits['min_pixels']) ||
          (limits['max_pixels'] !== undefined && pixels > limits['max_pixels']);

        if (invalid) {
          return ctx.fail(`The ${ctx.attribute} has invalid image dimensions.`);
        }
      }

      return true;
    },
  },

  // ------------------------------------------------------------------------
  // Authorization and authentication
  // ------------------------------------------------------------------------

  /**
   * current_password[:guard] - compares the value against the guard's
   * authenticated user's stored hash, like Illuminate's
   * ValidateCurrentPassword. Implicit: a missing value still fails.
   */
  current_password: {
    implicit: true,
    passes: async (ctx) => {
      const failure = ctx.fail(`The ${ctx.attribute} does not match the current password.`);
      const user = await resolveAuthUser(ctx.params[0]);

      if (!user) {
        return failure;
      }

      const stored = user.getAuthPassword();

      if (typeof ctx.value !== 'string' || stored === null) {
        return failure;
      }

      return resolveHasher().check(ctx.value, stored) ? true : failure;
    },
  },

  /**
   * can:ability[,field...] - checks the gate with the listed field values
   * as ability arguments. Delegates to the same CanRule the Rule.can object
   * uses (DRY), so the gate's denial message surfaces on the field.
   * Implicit: the check does not depend on the attribute's own value.
   */
  can: {
    implicit: true,
    passes: async (ctx) => {
      const [ability, ...argFields] = ctx.list;
      const args = argFields.map((field) => ctx.other(field));
      // Same rule object the Rule.can builder produces, consulted with the
      // named fields' values as ability arguments (DRY)
      const rule = new CanRule(ability, ...args);
      const allowed = await rule.passes();

      if (allowed) {
        return true;
      }

      const denial = rule.messageFor(ctx.attribute);

      return typeof denial === 'string' ? denial : ctx.fail(`The ${ctx.attribute} is invalid.`);
    },
  },

  /**
   * password - Laravel's Password::defaults() string form: the shared
   * checkPassword implementation with default options (min 8); the fluent
   * Rule.password() object opts into stricter checks (DRY).
   */
  password: {
    passes: (ctx) => {
      if (ctx.value === undefined || ctx.value === null) {
        return true;
      }

      return checkPassword(ctx.value, PASSWORD_DEFAULTS, ctx.attribute) ?? true;
    },
  },
};
