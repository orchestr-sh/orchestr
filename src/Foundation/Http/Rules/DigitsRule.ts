import { BaseRule } from './Base';

export class DigitsRule extends BaseRule {
  constructor(length: number) {
    super(`digits:${length}`);
  }
}
