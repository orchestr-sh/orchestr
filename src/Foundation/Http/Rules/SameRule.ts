import { BaseRule } from './Base';

export class SameRule extends BaseRule {
  constructor(field: string) {
    super(`same:${field}`);
  }
}
