import { BaseRule } from './Base';

export class CanRule extends BaseRule {
  constructor(ability: string) {
    super(`can:${ability}`);
  }
}
