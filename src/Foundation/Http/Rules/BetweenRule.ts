import { BaseRule } from './Base';

export class BetweenRule extends BaseRule {
  constructor(min: number, max: number) {
    super(`between:${min}:${max}`);
  }
}
