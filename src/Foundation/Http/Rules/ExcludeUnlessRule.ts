import { BaseRule } from './Base';

export class ExcludeUnlessRule extends BaseRule {
  constructor(field: string, value: string | number | boolean) {
    super(`exclude_unless:${field}:${String(value)}`);
  }
}
