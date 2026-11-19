/**
 * Date casts
 *
 * The `date`, `datetime`, `timestamp` and immutable variants: reads and
 * writes travel as `Date` objects, exactly where Laravel keeps Carbons, and
 * an explicit format (`date:Y-m-d`) decides only how the value serializes -
 * the in-memory shape stays a Date so dirty comparison still runs on
 * timestamps.
 *
 * Laravel: HasAttributes::asDateTime() / asDate() and the
 * immutable `AsTimestamp`-style cast strings
 */

import type { CastsAttributes } from '@/Database/Contracts/CastsAttributes';
import { formatDate } from './PhpDate';

export type DateCastKind = 'date' | 'datetime' | 'timestamp';

/**
 * A Date that refuses every mutation.
 * Laravel: Carbon's immutable variants (CarbonImmutable)
 */
export class ImmutableDate extends Date {
  constructor(value: number | string | Date) {
    super(value instanceof Date ? value.getTime() : (value as any));
  }

  setTime(_value: number): number {
    return fail();
  }

  setMilliseconds(_value: number): number {
    return fail();
  }

  setUTCMilliseconds(_value: number): number {
    return fail();
  }

  setSeconds(_value: number, _seconds?: number): number {
    return fail();
  }

  setUTCSeconds(_value: number, _seconds?: number): number {
    return fail();
  }

  setMinutes(_value: number, _minutes?: number): number {
    return fail();
  }

  setUTCMinutes(_value: number, _minutes?: number): number {
    return fail();
  }

  setHours(_value: number, _hours?: number): number {
    return fail();
  }

  setUTCHours(_value: number, _hours?: number): number {
    return fail();
  }

  setDate(_value: number): number {
    return fail();
  }

  setUTCDate(_value: number): number {
    return fail();
  }

  setMonth(_value: number, _month?: number): number {
    return fail();
  }

  setUTCMonth(_value: number, _month?: number): number {
    return fail();
  }

  setFullYear(_value: number, _year?: number): number {
    return fail();
  }

  setUTCFullYear(_value: number, _year?: number): number {
    return fail();
  }
}

function fail(): never {
  throw new TypeError('The date is immutable and cannot be modified.');
}

export class DateCast implements CastsAttributes {
  constructor(
    protected kind: DateCastKind = 'datetime',
    protected format?: string,
    protected immutable: boolean = false
  ) {}

  get(_model: any, key: string, value: any): any {
    if (value === null || value === undefined) {
      return value;
    }

    const date = this.toDate(key, value);

    if (this.kind === 'date') {
      date.setHours(0, 0, 0, 0);
    }

    return this.immutable ? new ImmutableDate(date) : date;
  }

  set(_model: any, key: string, value: any): any {
    if (value === null || value === undefined) {
      return value;
    }

    const date = this.toDate(key, value);

    if (this.kind === 'date') {
      date.setHours(0, 0, 0, 0);
    }

    return this.immutable ? new ImmutableDate(date) : date;
  }

  serialize(_model: any, key: string, value: any): any {
    if (value === null || value === undefined) {
      return value;
    }

    if (this.format) {
      return formatDate(this.toDate(key, value), this.format);
    }

    if (this.kind === 'timestamp') {
      return Math.floor(this.toDate(key, value).getTime() / 1000);
    }

    return value;
  }

  protected toDate(key: string, value: any): Date {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);

    if (Number.isNaN(date.getTime())) {
      throw new Error(`The attribute [${key}] is not a valid date.`);
    }

    return date;
  }
}
