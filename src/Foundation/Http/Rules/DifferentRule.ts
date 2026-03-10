import { BaseRule } from './Base';

export class DifferentRule extends BaseRule {
  constructor(field: string) {
    super(`different:${field}`);
  }
}
