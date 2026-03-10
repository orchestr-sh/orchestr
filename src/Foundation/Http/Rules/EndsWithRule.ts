import { BaseRule } from './Base';

export class EndsWithRule extends BaseRule {
  constructor(values: string[]) {
    super(`ends_with:${values.join(',')}`);
  }
}
