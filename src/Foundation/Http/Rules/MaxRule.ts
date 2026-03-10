import { BaseRule } from './Base';

export class MaxRule extends BaseRule {
  constructor(n: number) {
    super(`max:${n}`);
  }
}
