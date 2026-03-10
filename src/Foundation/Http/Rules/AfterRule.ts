import { BaseRule } from './Base';

export class AfterRule extends BaseRule {
  constructor(dateOrField: string) {
    super(`after:${dateOrField}`);
  }
}
