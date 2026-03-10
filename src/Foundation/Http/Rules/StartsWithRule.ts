import { BaseRule } from './Base';

export class StartsWithRule extends BaseRule {
  constructor(values: string[]) {
    super(`starts_with:${values.join(',')}`);
  }
}
