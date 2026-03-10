import { BaseRule } from './Base';

export class NotInRule extends BaseRule {
  constructor(values: Array<string | number>) {
    super(`not_in:${values.map(String).join(',')}`);
  }
}
