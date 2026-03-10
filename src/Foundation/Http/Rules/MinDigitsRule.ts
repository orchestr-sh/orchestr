import { BaseRule } from './Base';

export class MinDigitsRule extends BaseRule {
  constructor(n: number) {
    super(`min_digits:${n}`);
  }
}
