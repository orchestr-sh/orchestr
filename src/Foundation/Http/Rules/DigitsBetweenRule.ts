import { BaseRule } from './Base';

export class DigitsBetweenRule extends BaseRule {
  constructor(min: number, max: number) {
    super(`digits_between:${min}:${max}`);
  }
}
