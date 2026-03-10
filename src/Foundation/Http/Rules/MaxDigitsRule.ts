import { BaseRule } from './Base';

export class MaxDigitsRule extends BaseRule {
  constructor(n: number) {
    super(`max_digits:${n}`);
  }
}
