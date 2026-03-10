import { BaseRule } from './Base';

export class RequiredWithAllRule extends BaseRule {
  constructor(...fields: string[]) {
    super(`required_with_all:${fields.join(',')}`);
  }
}
