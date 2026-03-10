import { BaseRule } from './Base';

export class RequiredWithRule extends BaseRule {
  constructor(...fields: string[]) {
    super(`required_with:${fields.join(',')}`);
  }
}
