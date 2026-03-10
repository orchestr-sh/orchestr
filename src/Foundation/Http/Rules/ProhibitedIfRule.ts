import { BaseRule } from './Base';

export class ProhibitedIfRule extends BaseRule {
  constructor(field: string, value: string | number | boolean) {
    super(`prohibited_if:${field}:${String(value)}`);
  }
}
