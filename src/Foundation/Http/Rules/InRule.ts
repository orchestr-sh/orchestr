import { BaseRule } from './Base';

export class InRule extends BaseRule {
  constructor(values: Array<string | number>) {
    super(`in:${values.map(String).join(',')}`);
  }
}
