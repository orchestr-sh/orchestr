import { BaseRule } from './Base';

export class BeforeRule extends BaseRule {
  constructor(dateOrField: string) {
    super(`before:${dateOrField}`);
  }
}
