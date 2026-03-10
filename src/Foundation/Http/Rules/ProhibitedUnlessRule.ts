import { BaseRule } from './Base';

export class ProhibitedUnlessRule extends BaseRule {
  constructor(field: string, value: string | number | boolean) {
    super(`prohibited_unless:${field}:${String(value)}`);
  }
}
