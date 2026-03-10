import { BaseRule } from './Base';

export class DateEqualsRule extends BaseRule {
  constructor(date: string) {
    super(`date_equals:${date}`);
  }
}
