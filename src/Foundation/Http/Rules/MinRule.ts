import { BaseRule } from './Base';

export class MinRule extends BaseRule {
  constructor(n: number) {
    super(`min:${n}`);
  }
}
