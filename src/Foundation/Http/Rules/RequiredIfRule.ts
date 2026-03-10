import { BaseRule } from './Base';

export class RequiredIfRule extends BaseRule {
  constructor(field: string, value: string | number | boolean) {
    super(`required_if:${field}:${String(value)}`);
  }
}
