/**
 * Number Class
 *
 * A TypeScript port of Illuminate\Support\Number, the numeric formatting
 * helpers Laravel exposes through the `Number` class. All methods are
 * static and free of framework / container dependencies so they are safe
 * to use in any context.
 *
 * Notes:
 * - Formatting helpers take explicit separator arguments instead of
 *   relying on PHP's locale-aware `number_format`.
 * - `abbreviate` uses decimal (1000) scaling with K / M / B / T suffixes,
 *   dropping the fractional part when the scaled value is a whole number.
 * - `fileSize` uses binary (1024) scaling, like Laravel.
 * - `spellout` supports English words only and is bounded to JavaScript's
 *   safe integer range: ±9007199254740991 (Number.MAX_SAFE_INTEGER).
 *   Non-integers and values beyond that range throw.
 */

import { Str } from './Str';

// The class name shadows the global `Number` constructor inside this
// module, so keep a direct reference for coercion and checks.
const NativeNumber = globalThis.Number;

const ORDINAL_TH = 'th';

const GROUP_NAMES = ['', 'Thousand', 'Million', 'Billion', 'Trillion', 'Quadrillion'];

const ONES = [
  'Zero',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];

const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

const FILE_SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

const FILE_SIZE_UNITS_CANONICAL = ['bytes', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB'];

const ABBREVIATION_UNITS = ['', 'K', 'M', 'B', 'T'];

/** Coerce a possibly loose argument to a trunc'd integer count. */
function toCount(value: number): number {
  const numeric = NativeNumber(value);

  if (NativeNumber.isNaN(numeric)) {
    return 0;
  }

  return Math.max(Math.trunc(numeric), 0);
}

/**
 * Round and format a number using PHP's number_format semantics: exact
 * half values round away from zero (1.005 -> '1.01'), which `toFixed`'s
 * binary-float behaviour would otherwise get wrong. The rounding result is
 * rebuilt as an exact decimal string, so no scientific notation leaks in.
 */
function formatNumber(value: number, decimals: number, decimalSeparator = '.', thousandsSeparator = ','): string {
  const numeric = NativeNumber(value);
  let absolute = Math.abs(numeric);

  if (!NativeNumber.isFinite(absolute)) {
    absolute = 0;
  }

  const factor = 10 ** decimals;
  const scaled = absolute * factor;

  // The epsilon nudge fixes binary halves like 1.005 * 100 === 100.49999…,
  // but it must not perturb values already beyond float resolution.
  const rounded = NativeNumber.isFinite(scaled)
    ? Math.round(scaled < 1e15 ? scaled * (1 + NativeNumber.EPSILON) : scaled)
    : 0;

  const roundedStr = BigInt(rounded).toString();
  let fixed = roundedStr;

  if (decimals > 0) {
    const padded = roundedStr.padStart(decimals + 1, '0');
    fixed = `${padded.slice(0, padded.length - decimals)}.${padded.slice(padded.length - decimals)}`;
  }

  const [integerPart, fractionPart] = fixed.split('.');

  const withThousands = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, thousandsSeparator);
  const output = fractionPart ? `${withThousands}${decimalSeparator}${fractionPart}` : withThousands;

  // A rounded value of zero must never carry the sign (e.g. -0.001 -> '0.00').
  if (numeric < 0 && rounded !== 0) {
    return `-${output}`;
  }

  return output;
}

/** Spell a 0-999 chunk in English words. */
function threeDigitsToWords(chunk: number): string {
  const parts: string[] = [];

  if (chunk >= 100) {
    parts.push(`${ONES[Math.floor(chunk / 100)]} Hundred`);
    chunk %= 100;
  }

  if (chunk > 0) {
    if (chunk < 20) {
      parts.push(ONES[chunk]);
    } else {
      const ten = Math.floor(chunk / 10) * 10;
      const unit = chunk % 10;

      parts.push(unit > 0 ? `${TENS[ten / 10]}-${ONES[unit]}` : TENS[ten / 10]);
    }
  }

  return parts.join(' ');
}

export class Number {
  /**
   * Format the given number into its human-readable equivalent.
   *
   * Number.format(1020) // '1,020'
   * Number.format(1020.1234, 2) // '1,020.12'
   * Number.format(1020.1234, 2, ',', '.') // '1.020,12'
   */
  static format(value: number, decimals = 0, decimalSeparator = '.', thousandsSeparator = ','): string {
    if (value === null || value === undefined) {
      return '0';
    }

    return formatNumber(NativeNumber(value), toCount(decimals), decimalSeparator, thousandsSeparator);
  }

  /**
   * Clamp a number within a given range. The bounds are rounded to the
   * given precisions first, like Laravel's Number::clamp.
   *
   * Number.clamp(12, 1, 10) // 10
   * Number.clamp(5, 1, 10) // 5
   */
  static clamp(value: number, min: number, max: number, minPrecision = 0, maxPrecision = 0): number {
    const lower = NativeNumber(formatNumber(NativeNumber(min), toCount(minPrecision), '.', ''));
    const upper = NativeNumber(formatNumber(NativeNumber(max), toCount(maxPrecision), '.', ''));

    if (upper < lower) {
      throw new Error('[$min] should be smaller than [$max].');
    }

    return Math.min(Math.max(NativeNumber(value), lower), upper);
  }

  /**
   * Convert the given number into its abbreviated human-readable
   * equivalent (thousands, millions, billions, trillions).
   *
   * Number.abbreviate(1000) // '1K'
   * Number.abbreviate(1234, 2) // '1.23K'
   * Number.abbreviate(-1200000) // '-1.2M'
   */
  static abbreviate(value: number, precision = 1): string {
    const numeric = NativeNumber(value);
    const decimals = toCount(precision);
    const negative = numeric < 0;
    const absolute = Math.abs(numeric);

    let units = absolute;
    let unit = 0;

    while (units > 999 && unit < ABBREVIATION_UNITS.length - 1) {
      units = units / 1000;
      unit++;
    }

    const fractionless = NativeNumber.isInteger(units) ? 0 : decimals;
    const formatted = formatNumber(units, fractionless, '.', '');

    return `${negative ? '-' : ''}${formatted}${ABBREVIATION_UNITS[unit]}`;
  }

  /**
   * Convert the given number into its English ordinal representation.
   *
   * Number.ordinal(1) // '1st'
   * Number.ordinal(11) // '11th'
   * Number.ordinal(21) // '21st'
   */
  static ordinal(value: number): string {
    const rounded = Math.round(Math.abs(value));
    const lastTwo = rounded % 100;

    if (lastTwo >= 11 && lastTwo <= 13) {
      return `${value}${ORDINAL_TH}`;
    }

    const suffix = ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[rounded % 10] ?? ORDINAL_TH;

    return `${value}${suffix}`;
  }

  /**
   * Convert the given number into its percentage representation.
   *
   * Number.percentage(12.34) // '12 %'
   * Number.percentage(10000, 2) // '10,000.00 %'
   * Number.percentage(10000, 0, true, false) // '10,000%'
   */
  static percentage(
    value: number,
    precision = 0,
    symbolic = true,
    space = true,
    decimalSeparator = '.',
    thousandsSeparator = ','
  ): string {
    const decimals = toCount(precision);
    const formatted = formatNumber(NativeNumber(value), decimals, decimalSeparator, thousandsSeparator);

    if (!symbolic) {
      return formatted;
    }

    return `${formatted}${space ? ' ' : ''}%`;
  }

  /**
   * Get the human-readable file size for a byte count, using binary
   * (1024) units like Laravel.
   *
   * Number.fileSize(1024) // '1 KB'
   * Number.fileSize(1024, 1) // '1.0 KB'
   * Number.fileSize(1024, 0, true) // '1 KiB'
   * Number.fileSize(-1024 ** 4) // '-1 TB'
   */
  static fileSize(bytes: number, precision = 0, canonical = false): string {
    const value = NativeNumber(bytes);
    const decimals = toCount(precision);
    const units = canonical ? FILE_SIZE_UNITS_CANONICAL : FILE_SIZE_UNITS;

    if (!NativeNumber.isFinite(value) || value === 0) {
      return `${formatNumber(0, decimals)} ${units[0]}`;
    }

    const sign = value < 0 ? '-' : '';
    const absolute = Math.abs(value);
    const index = Math.max(Math.min(Math.floor(Math.log(absolute) / Math.log(1024)), units.length - 1), 0);
    const scaled = absolute / 1024 ** index;

    return `${sign}${formatNumber(scaled, decimals)} ${units[index]}`;
  }

  /**
   * Spell the given integer in English words, like Laravel's
   * Number::spellout. Capitalised, hyphenated ("Twenty-One") and grouped
   * with commas ("One Million, One Hundred").
   *
   * Number.spell(21) // 'Twenty-One'
   *
   * @throws When the value is not an integer or exceeds the JavaScript
   * safe integer range (±9007199254740991).
   */
  static spell(value: number): string {
    if (!NativeNumber.isInteger(value)) {
      throw new Error('This method only supports integers.');
    }

    if (Math.abs(value) > NativeNumber.MAX_SAFE_INTEGER) {
      throw new Error(`This method only supports numbers up to ${NativeNumber.MAX_SAFE_INTEGER}.`);
    }

    if (value === 0) {
      return ONES[0];
    }

    const negative = value < 0;
    let remaining = Math.abs(value);
    const parts: string[] = [];
    let group = 0;

    while (remaining > 0) {
      const chunk = remaining % 1000;

      if (chunk > 0) {
        parts.unshift(threeDigitsToWords(chunk) + (group > 0 ? ` ${GROUP_NAMES[group]}` : ''));
      }

      remaining = Math.floor(remaining / 1000);
      group++;
    }

    return `${negative ? 'Negative ' : ''}${parts.join(', ')}`;
  }

  /**
   * Laravel-compatible alias of Number.spell (Illuminate's method is
   * named spellout).
   */
  static spellout(value: number): string {
    return Number.spell(value);
  }
}
