import { BaseRule } from './Base';

export class InArrayRule extends BaseRule {
  constructor(field: string) {
    super(`in_array:${field}`);
  }
}
