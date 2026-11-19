/**
 * Decimal cast
 *
 * `decimal:places` keeps money out of binary float arguments: a read hands
 * back the value rendered with exactly the declared places, while a write
 * stores the number as text so the full precision survives the round trip.
 *
 * Laravel: HasAttributes::asDecimal() and the decimal write path
 */

import type { CastsAttributes } from '@/Database/Contracts/CastsAttributes';

export class DecimalCast implements CastsAttributes {
  constructor(protected places: number = 2) {}

  get(_model: any, _key: string, value: any): any {
    if (value === null || value === undefined) {
      return value;
    }

    return Number(value).toFixed(this.places);
  }

  set(_model: any, _key: string, value: any): any {
    if (value === null || value === undefined) {
      return value;
    }

    const numeric = typeof value === 'number' ? value : Number(value);

    return Number.isNaN(numeric) ? value : String(numeric);
  }

  serialize(_model: any, key: string, value: any): any {
    return this.get(_model, key, value);
  }
}
