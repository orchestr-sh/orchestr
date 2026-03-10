import { BaseRule } from './Base';

export class ExcludeIfRule extends BaseRule {
  constructor(field: string, value: string | number | boolean) {
    super(`exclude_if:${field}:${String(value)}`);
  }
}
