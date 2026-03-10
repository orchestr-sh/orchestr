import { BaseRule } from './Base';

export class GteRule extends BaseRule {
  constructor(fieldOrValue: string | number) {
    super(`gte:${String(fieldOrValue)}`);
  }
}
