import { BaseRule } from './Base';

export class LteRule extends BaseRule {
  constructor(fieldOrValue: string | number) {
    super(`lte:${String(fieldOrValue)}`);
  }
}
