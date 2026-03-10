import { BaseRule } from './Base';

export class ProhibitsRule extends BaseRule {
  constructor(fields: string[]) {
    super(`prohibits:${fields.join(',')}`);
  }
}
