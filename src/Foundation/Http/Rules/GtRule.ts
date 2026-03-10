import { BaseRule } from './Base';

export class GtRule extends BaseRule {
  constructor(fieldOrValue: string | number) {
    super(`gt:${String(fieldOrValue)}`);
  }
}
