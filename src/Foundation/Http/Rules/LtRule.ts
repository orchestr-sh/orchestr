import { BaseRule } from './Base';

export class LtRule extends BaseRule {
  constructor(fieldOrValue: string | number) {
    super(`lt:${String(fieldOrValue)}`);
  }
}
