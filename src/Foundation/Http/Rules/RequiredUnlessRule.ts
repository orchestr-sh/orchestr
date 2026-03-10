import { BaseRule } from './Base';

export class RequiredUnlessRule extends BaseRule {
  constructor(field: string, value: string | number | boolean) {
    super(`required_unless:${field}:${String(value)}`);
  }
}
