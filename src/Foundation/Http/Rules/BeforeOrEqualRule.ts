import { BaseRule } from './Base';

export class BeforeOrEqualRule extends BaseRule {
  constructor(dateOrField: string) {
    super(`before_or_equal:${dateOrField}`);
  }
}
