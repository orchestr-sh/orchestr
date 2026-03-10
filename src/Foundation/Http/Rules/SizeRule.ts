import { BaseRule } from './Base';

export class SizeRule extends BaseRule {
  constructor(n: number) {
    super(`size:${n}`);
  }
}
