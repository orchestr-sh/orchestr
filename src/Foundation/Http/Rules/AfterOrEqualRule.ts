import { BaseRule } from './Base';

export class AfterOrEqualRule extends BaseRule {
  constructor(dateOrField: string) {
    super(`after_or_equal:${dateOrField}`);
  }
}
