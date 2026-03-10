import { BaseRule } from './Base';

export class MultipleOfRule extends BaseRule {
  constructor(n: number) {
    super(`multiple_of:${n}`);
  }
}
